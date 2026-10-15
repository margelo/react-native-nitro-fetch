//
//  NWStreamWebSocketConnection.mm
//  Pods
//
//  Created by Ritesh Shukla on 23.03.26.
//

#import <Foundation/Foundation.h>
#import <CFNetwork/CFNetwork.h>
#import <CommonCrypto/CommonDigest.h>
#import <Network/Network.h>
#import <Security/SecureTransport.h>
#include "NWStreamWebSocketConnection.hpp"
#include "Utf8.hpp"

#include <sys/utsname.h>
#include <zlib.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <deque>
#include <optional>
#include <string_view>

#if defined(NITRO_WS_TRACING)
#include <os/log.h>
#include <os/signpost.h>

static os_log_t nitroWsLog() {
  static os_log_t log = os_log_create("com.margelo.nitro.websockets", "NitroWS");
  return log;
}
#endif

namespace margelo::nitro::nitrofetchwebsockets {

namespace {

constexpr uint8_t kOpContinuation = 0x0;
constexpr uint8_t kOpText = 0x1;
constexpr uint8_t kOpBinary = 0x2;
constexpr uint8_t kOpClose = 0x8;
constexpr uint8_t kOpPing = 0x9;
constexpr uint8_t kOpPong = 0xA;
constexpr uint8_t kFin = 0x80;
constexpr uint8_t kRsv1 = 0x40;

constexpr size_t kMaxMessageSize = 16 * 1024 * 1024;
constexpr size_t kMaxHandshakeSize = 256 * 1024;
constexpr uint32_t kReadSize = 4 * 1024 * 1024;
constexpr int kMaxRedirects = 20;
constexpr size_t kMinDeflateSize = 1024;
constexpr int64_t kHandshakeTimeout = 60 * NSEC_PER_SEC;
constexpr int64_t kCloseTimeout = 5 * NSEC_PER_SEC;

struct BufferedMessage {
  std::vector<uint8_t> data;
  bool isBinary;
};

using Fields = std::vector<std::pair<std::string, std::string>>;

bool equalsIgnoreCase(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); i++) {
    if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
  }
  return true;
}

std::string_view trim(std::string_view s) {
  while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.remove_prefix(1);
  while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.remove_suffix(1);
  return s;
}

std::vector<std::string_view> split(std::string_view s, char separator) {
  std::vector<std::string_view> parts;
  size_t start = 0;
  while (true) {
    size_t end = s.find(separator, start);
    parts.push_back(trim(s.substr(start, end == std::string_view::npos ? std::string_view::npos : end - start)));
    if (end == std::string_view::npos) return parts;
    start = end + 1;
  }
}

bool hasToken(std::string_view list, std::string_view token) {
  for (auto part : split(list, ',')) {
    if (equalsIgnoreCase(part, token)) return true;
  }
  return false;
}

const std::string* findField(const Fields& fields, std::string_view name) {
  for (const auto& field : fields) {
    if (equalsIgnoreCase(field.first, name)) return &field.second;
  }
  return nullptr;
}

void setField(Fields& fields, const std::string& name, const std::string& value) {
  for (auto& field : fields) {
    if (equalsIgnoreCase(field.first, name)) {
      field = { name, value };
      return;
    }
  }
  fields.emplace_back(name, value);
}

std::string stdString(NSString* s) {
  const char* utf8 = s.UTF8String;
  return utf8 ? std::string(utf8) : std::string();
}

std::optional<std::string> headerValue(CFHTTPMessageRef message, CFStringRef name) {
  NSString* value = CFBridgingRelease(CFHTTPMessageCopyHeaderFieldValue(message, name));
  if (!value) return std::nullopt;
  return stdString(value);
}

std::string base64(const uint8_t* data, size_t len) {
  NSData* bytes = [NSData dataWithBytes:data length:len];
  return stdString([bytes base64EncodedStringWithOptions:0]);
}

std::string acceptKey(const std::string& key) {
  const std::string input = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  uint8_t digest[CC_SHA1_DIGEST_LENGTH];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CC_SHA1(input.data(), static_cast<CC_LONG>(input.size()), digest);
#pragma clang diagnostic pop
  return base64(digest, sizeof(digest));
}

const std::string& userAgent() {
  static const std::string agent = [] {
    NSCharacterSet* allowed = [NSCharacterSet characterSetWithCharactersInString:
      @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!$&'*+-._~"];
    NSBundle* main = NSBundle.mainBundle;
    NSString* name = [main objectForInfoDictionaryKey:(__bridge NSString*)kCFBundleNameKey];
    if (name.length == 0) name = NSProcessInfo.processInfo.processName;
    NSString* product = [name stringByAddingPercentEncodingWithAllowedCharacters:allowed] ?: name;
    NSString* version = [[main objectForInfoDictionaryKey:(__bridge NSString*)kCFBundleVersionKey]
      stringByAddingPercentEncodingWithAllowedCharacters:allowed];
    NSString* network = [[NSBundle bundleWithIdentifier:@"com.apple.CFNetwork"]
      objectForInfoDictionaryKey:(__bridge NSString*)kCFBundleVersionKey];
    struct utsname system;
    uname(&system);
    NSString* app = version.length > 0
      ? [NSString stringWithFormat:@"%@/%@", product, version]
      : [NSString stringWithFormat:@"%@ (unknown version)", product];
    return stdString([NSString stringWithFormat:@"%@ CFNetwork/%@ Darwin/%s", app, network, system.release]);
  }();
  return agent;
}

std::string posixDescription(int code) {
  return stdString([NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:nil].localizedDescription);
}

std::string errorDescription(nw_error_t error, int fallback) {
  if (error) {
    CFErrorRef cfError = nw_error_copy_cf_error(error);
    if (cfError) {
      NSError* nsError = CFBridgingRelease(cfError);
      return stdString(nsError.localizedDescription);
    }
  }
  return posixDescription(fallback);
}

std::string connectErrorDescription(nw_error_t error, NSString* host) {
  const int code = error ? nw_error_get_error_code(error) : ENOTCONN;
  const nw_error_domain_t domain = error ? nw_error_get_error_domain(error) : nw_error_domain_posix;
  if (domain == nw_error_domain_dns) return "A server with the specified hostname could not be found.";
  if (domain == nw_error_domain_tls) {
    switch (code) {
      case errSSLXCertChainInvalid:
      case errSSLBadCert:
      case errSSLUnknownRootCert:
      case errSSLNoRootCert:
      case errSSLCertExpired:
      case errSSLCertNotYetValid:
      case errSSLHostNameMismatch:
        return "The certificate for this server is invalid. You might be connecting to a server that is pretending to be \u201c" +
               stdString(host) + "\u201d which could put your confidential information at risk.";
      default:
        return "A TLS error caused the secure connection to fail.";
    }
  }
  if (code == ENETDOWN) return "The Internet connection appears to be offline.";
  if (code == ETIMEDOUT) return "The request timed out.";
  return "Could not connect to the server.";
}

bool isAllowedScheme(NSString* scheme) {
  NSString* lower = scheme.lowercaseString;
  return [lower isEqualToString:@"ws"] || [lower isEqualToString:@"wss"] ||
         [lower isEqualToString:@"http"] || [lower isEqualToString:@"https"];
}

bool isValidTarget(NSURL* url) {
  if (!url || !isAllowedScheme(url.scheme) || url.host.length == 0) return false;
  return !url.port || (url.port.integerValue > 0 && url.port.integerValue <= 65535);
}

bool isSecureScheme(NSString* scheme) {
  NSString* lower = scheme.lowercaseString;
  return [lower isEqualToString:@"wss"] || [lower isEqualToString:@"https"];
}

NSURL* cookieURL(NSURL* url) {
  NSURLComponents* components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:YES];
  components.scheme = isSecureScheme(url.scheme) ? @"https" : @"http";
  return components.URL;
}

bool isValidCloseCode(int code) {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
}

std::string closePayload(int code, const std::string& reason) {
  size_t len = std::min<size_t>(reason.size(), 123);
  while (len > 0 && len < reason.size() && (static_cast<uint8_t>(reason[len]) & 0xC0) == 0x80) len--;
  std::string payload;
  payload.reserve(2 + len);
  payload.push_back(static_cast<char>((code >> 8) & 0xFF));
  payload.push_back(static_cast<char>(code & 0xFF));
  payload.append(reason, 0, len);
  return payload;
}

void maskInto(uint8_t* dst, const uint8_t* src, size_t len, const uint8_t key[4]) {
  uint32_t key32;
  std::memcpy(&key32, key, 4);
  const uint64_t key64 = (static_cast<uint64_t>(key32) << 32) | key32;
  size_t i = 0;
  for (; i + 8 <= len; i += 8) {
    uint64_t chunk;
    std::memcpy(&chunk, src + i, 8);
    chunk ^= key64;
    std::memcpy(dst + i, &chunk, 8);
  }
  for (; i < len; i++) dst[i] = src[i] ^ key[i & 3];
}

dispatch_data_t makeFrame(uint8_t first, const uint8_t* payload, size_t len) {
  const size_t header = len < 126 ? 6 : (len <= 0xFFFF ? 8 : 14);
  auto* frame = static_cast<uint8_t*>(malloc(header + len));
  frame[0] = first;
  size_t pos;
  if (len < 126) {
    frame[1] = static_cast<uint8_t>(0x80 | len);
    pos = 2;
  } else if (len <= 0xFFFF) {
    frame[1] = 0x80 | 126;
    frame[2] = static_cast<uint8_t>(len >> 8);
    frame[3] = static_cast<uint8_t>(len);
    pos = 4;
  } else {
    frame[1] = 0x80 | 127;
    for (int i = 0; i < 8; i++) frame[2 + i] = static_cast<uint8_t>(static_cast<uint64_t>(len) >> (56 - 8 * i));
    pos = 10;
  }
  uint8_t key[4];
  arc4random_buf(key, sizeof(key));
  std::memcpy(frame + pos, key, 4);
  maskInto(frame + pos + 4, payload, len, key);
  return dispatch_data_create(frame, header + len, nullptr, DISPATCH_DATA_DESTRUCTOR_FREE);
}

dispatch_data_t makeData(const std::string& bytes) {
  return dispatch_data_create(bytes.data(), bytes.size(), nullptr, DISPATCH_DATA_DESTRUCTOR_DEFAULT);
}

} // namespace

struct NWStreamWebSocketConnection::Impl {
  explicit Impl(NWStreamWebSocketConnection* owner) : owner(owner) {
    dispatch_queue_attr_t attributes =
      dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0);
    queue = dispatch_queue_create("com.margelo.nitro.websockets.connection", attributes);
  }

  ~Impl() {
    if (connection) nw_connection_force_cancel(connection);
    releaseCompression();
  }

  NWStreamWebSocketConnection* owner;
  dispatch_queue_t queue;
  std::weak_ptr<WebSocketConnectionBase> weakSelf;
  std::shared_ptr<WebSocketConnectionBase> selfRef;
  nw_connection_t connection = nil;
  uint64_t timerGeneration = 0;
  bool connected = false;

  NSURL* url = nil;
  Fields extraHeaders;
  std::string requestedProtocols;
  std::string key;
  std::string offeredProtocols;
  std::string offeredExtensions;
  std::vector<uint8_t> handshake;
  int redirects = 0;
  bool open = false;

  std::vector<uint8_t> pendingFrame;
  std::vector<uint8_t> message;
  size_t streamRemaining = 0;
  bool streamFin = false;
  bool inMessage = false;
  bool messageBinary = false;
  bool messageCompressed = false;

  bool perMessageDeflate = false;
  bool serverNoContextTakeover = false;
  bool clientNoContextTakeover = false;
  int clientWindowBits = MAX_WBITS;
  z_stream* inflater = nullptr;
  z_stream* deflater = nullptr;

  bool closeSent = false;
  bool closeWritten = false;
  bool localClose = false;
  bool stopped = false;
  bool finished = false;
  int closeCode = 0;
  std::string closeReason;
  std::optional<std::string> failure;

  OnOpen onOpen;
  OnMessage onMessage;
  OnClose onClose;
  OnError onError;
  bool openPending = false;
  struct PendingClose { int code; std::string reason; bool wasClean; };
  std::optional<std::string> errorPending;
  std::optional<PendingClose> closePending;
  std::deque<BufferedMessage> buffered;

#if defined(NITRO_WS_TRACING)
  os_signpost_id_t signpost = OS_SIGNPOST_ID_NULL;
#endif

  static Impl* from(const std::shared_ptr<WebSocketConnectionBase>& self) {
    return static_cast<NWStreamWebSocketConnection*>(self.get())->_impl.get();
  }

  void begin(const std::shared_ptr<WebSocketConnectionBase>& self, NSURL* target,
             const std::string& protocols, const Fields& headers) {
    if (finished) return;
    weakSelf = self;
    requestedProtocols = protocols;
    extraHeaders = headers;
    if (owner->_state.load(std::memory_order_acquire) != State::CONNECTING) return;
    if (!isValidTarget(target)) {
      finish(1006, "", false, "Invalid WebSocket URL: " + owner->url());
      return;
    }
    start(target);
  }

  void start(NSURL* target) {
    url = target;
    connected = false;
    handshake.clear();
    const bool secure = isSecureScheme(target.scheme);
    const int port = target.port ? target.port.intValue : (secure ? 443 : 80);
    nw_endpoint_t endpoint = nw_endpoint_create_host(target.host.UTF8String, std::to_string(port).c_str());
    nw_parameters_t parameters = nw_parameters_create_secure_tcp(
      secure ? NW_PARAMETERS_DEFAULT_CONFIGURATION : NW_PARAMETERS_DISABLE_PROTOCOL,
      ^(nw_protocol_options_t options) {
        nw_tcp_options_set_no_delay(options, true);
      });
    nw_connection_t created = nw_connection_create(endpoint, parameters);
    connection = created;
    nw_connection_set_queue(created, queue);
    auto weak = weakSelf;
    nw_connection_set_state_changed_handler(created, ^(nw_connection_state_t state, nw_error_t error) {
      auto strong = weak.lock();
      if (!strong) return;
      Impl* impl = from(strong);
      if (impl->connection != created || impl->finished) return;
      if (state == nw_connection_state_ready) {
        impl->connected = true;
        impl->sendHandshake();
        impl->readHandshake();
      } else if (state == nw_connection_state_waiting || state == nw_connection_state_failed) {
        impl->transportFailed(error);
      }
    });
    armTimer(kHandshakeTimeout, "The request timed out.");
    nw_connection_start(created);
  }

  void sendHandshake() {
    uint8_t nonce[16];
    arc4random_buf(nonce, sizeof(nonce));
    const bool secure = isSecureScheme(url.scheme);
    std::string host = stdString(url.host);
    if (host.find(':') != std::string::npos) host = "[" + host + "]";
    if (url.port && url.port.intValue != (secure ? 443 : 80)) host += ":" + std::to_string(url.port.intValue);

    Fields fields = {
      { "Host", host },
      { "Upgrade", "websocket" },
      { "Connection", "Upgrade" },
      { "Sec-WebSocket-Key", base64(nonce, sizeof(nonce)) },
      { "Sec-WebSocket-Version", "13" },
    };
    if (!requestedProtocols.empty() && requestedProtocols.find_first_of("\r\n") == std::string::npos) {
      fields.emplace_back("Sec-WebSocket-Protocol", requestedProtocols);
    }
    fields.emplace_back("Sec-WebSocket-Extensions", "permessage-deflate");
    NSMutableArray<NSHTTPCookie*>* cookies = [NSMutableArray array];
    for (NSHTTPCookie* stored in [NSHTTPCookieStorage.sharedHTTPCookieStorage cookiesForURL:cookieURL(url)]) {
      if (secure || !stored.isSecure) [cookies addObject:stored];
    }
    NSString* cookie = [NSHTTPCookie requestHeaderFieldsWithCookies:cookies][@"Cookie"];
    if (cookie.length > 0) fields.emplace_back("Cookie", stdString(cookie));
    fields.emplace_back("User-Agent", userAgent());
    for (const auto& [name, value] : extraHeaders) {
      if (name.empty() || name.find_first_of(":\r\n") != std::string::npos ||
          value.find_first_of("\r\n") != std::string::npos) {
        continue;
      }
      setField(fields, name, value);
    }

    const std::string* sentKey = findField(fields, "Sec-WebSocket-Key");
    key = sentKey ? *sentKey : std::string();
    const std::string* sentProtocols = findField(fields, "Sec-WebSocket-Protocol");
    offeredProtocols = sentProtocols ? *sentProtocols : std::string();
    const std::string* sentExtensions = findField(fields, "Sec-WebSocket-Extensions");
    offeredExtensions = sentExtensions ? *sentExtensions : std::string();

    NSURLComponents* components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:YES];
    std::string target = stdString(components.percentEncodedPath);
    if (target.empty()) target = "/";
    if (components.percentEncodedQuery) target += "?" + stdString(components.percentEncodedQuery);

    std::string request = "GET " + target + " HTTP/1.1\r\n";
    for (const auto& [name, value] : fields) request += name + ": " + value + "\r\n";
    request += "\r\n";
    nw_connection_send(connection, makeData(request), NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, true,
                       ^(nw_error_t) {});
  }

  void readHandshake() {
    nw_connection_t current = connection;
    auto weak = weakSelf;
    nw_connection_receive(current, 1, kReadSize,
      ^(dispatch_data_t content, nw_content_context_t context, bool isComplete, nw_error_t error) {
        auto strong = weak.lock();
        if (!strong) return;
        Impl* impl = from(strong);
        if (impl->connection != current || impl->finished) return;
        if (content) {
          const size_t searched = impl->handshake.size() < 3 ? 0 : impl->handshake.size() - 3;
          dispatch_data_apply(content, ^bool(dispatch_data_t, size_t, const void* buffer, size_t size) {
            const auto* bytes = static_cast<const uint8_t*>(buffer);
            impl->handshake.insert(impl->handshake.end(), bytes, bytes + size);
            return true;
          });
          static constexpr uint8_t kEnd[] = { '\r', '\n', '\r', '\n' };
          auto end = std::search(impl->handshake.begin() + static_cast<std::ptrdiff_t>(searched), impl->handshake.end(),
                                 std::begin(kEnd), std::end(kEnd));
          const size_t headerSize = end == impl->handshake.end()
            ? impl->handshake.size()
            : static_cast<size_t>(end - impl->handshake.begin()) + sizeof(kEnd);
          if (headerSize > kMaxHandshakeSize) {
            impl->finish(1006, "", false, "There was a bad response from the server.");
            return;
          }
          if (end != impl->handshake.end()) {
            impl->handshakeReceived(headerSize);
            return;
          }
        }
        if (error || (isComplete && (!context || nw_content_context_get_is_final(context)))) {
          impl->transportFailed(error);
          return;
        }
        impl->readHandshake();
      });
  }

  void handshakeReceived(size_t headerSize) {
    CFHTTPMessageRef response = CFHTTPMessageCreateEmpty(kCFAllocatorDefault, false);
    CFHTTPMessageAppendBytes(response, handshake.data(), static_cast<CFIndex>(headerSize));
    std::vector<uint8_t> leftover(handshake.begin() + static_cast<std::ptrdiff_t>(headerSize), handshake.end());
    handshake.clear();
    handshake.shrink_to_fit();
    if (!CFHTTPMessageIsHeaderComplete(response)) {
      CFRelease(response);
      finish(1006, "", false, "There was a bad response from the server.");
      return;
    }

    const CFIndex status = CFHTTPMessageGetResponseStatusCode(response);
    NSString* version = CFBridgingRelease(CFHTTPMessageCopyVersion(response));
    NSString* setCookie = CFBridgingRelease(CFHTTPMessageCopyHeaderFieldValue(response, CFSTR("Set-Cookie")));
    if (setCookie.length > 0) {
      NSURL* storageURL = cookieURL(url);
      NSArray<NSHTTPCookie*>* cookies =
        [NSHTTPCookie cookiesWithResponseHeaderFields:@{ @"Set-Cookie": setCookie } forURL:storageURL];
      [NSHTTPCookieStorage.sharedHTTPCookieStorage setCookies:cookies forURL:storageURL mainDocumentURL:nil];
    }

    const auto location = headerValue(response, CFSTR("Location"));
    const auto upgrade = headerValue(response, CFSTR("Upgrade"));
    const auto connectionHeader = headerValue(response, CFSTR("Connection"));
    const auto accept = headerValue(response, CFSTR("Sec-WebSocket-Accept"));
    const auto protocol = headerValue(response, CFSTR("Sec-WebSocket-Protocol"));
    const auto extensions = headerValue(response, CFSTR("Sec-WebSocket-Extensions"));
    CFRelease(response);

    if ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && location) {
      redirect(*location);
      return;
    }
    const std::string badResponse = "There was a bad response from the server.";
    if (status != 101 || ![version isEqualToString:(__bridge NSString*)kCFHTTPVersion1_1] || !upgrade ||
        !equalsIgnoreCase(trim(*upgrade), "websocket") ||
        !connectionHeader || !hasToken(*connectionHeader, "upgrade") ||
        !accept || std::string(trim(*accept)) != acceptKey(key)) {
      finish(1006, "", false, badResponse);
      return;
    }

    std::string negotiatedProtocol;
    if (protocol && !trim(*protocol).empty()) {
      negotiatedProtocol = std::string(trim(*protocol));
      bool offered = false;
      for (auto candidate : split(offeredProtocols, ',')) {
        if (candidate == negotiatedProtocol) offered = true;
      }
      if (!offered) {
        finish(1006, "", false, badResponse);
        return;
      }
    }
    std::string negotiatedExtensions;
    if (extensions && !trim(*extensions).empty()) {
      negotiatedExtensions = std::string(trim(*extensions));
      if (!configureDeflate(negotiatedExtensions)) {
        finish(1006, "", false, badResponse);
        return;
      }
    }

    {
      std::lock_guard<std::mutex> lock(owner->_strMu);
      owner->_negotiatedProtocol = negotiatedProtocol;
      owner->_extensions = negotiatedExtensions;
    }
    {
      std::lock_guard<std::mutex> lock(owner->_sendMu);
      if (owner->_state.load(std::memory_order_acquire) != State::CONNECTING) return;
      owner->_state.store(State::OPEN, std::memory_order_release);
    }
    open = true;
    cancelTimer();
#if defined(NITRO_WS_TRACING)
    os_signpost_interval_end(nitroWsLog(), signpost, "NitroWS", "connected");
#endif
    if (onOpen) {
      onOpen();
    } else {
      openPending = true;
    }
    if (!leftover.empty()) consume(leftover.data(), leftover.size());
    if (!stopped) readFrames();
  }

  bool configureDeflate(const std::string& response) {
    bool offered = false;
    for (auto offer : split(offeredExtensions, ',')) {
      if (equalsIgnoreCase(split(offer, ';')[0], "permessage-deflate")) offered = true;
    }
    auto accepted = split(response, ',');
    if (!offered || accepted.size() != 1) return false;
    auto params = split(accepted[0], ';');
    if (!equalsIgnoreCase(params[0], "permessage-deflate")) return false;
    bool seenServerNoContext = false;
    bool seenClientNoContext = false;
    bool seenServerBits = false;
    bool seenClientBits = false;
    for (size_t i = 1; i < params.size(); i++) {
      const size_t eq = params[i].find('=');
      auto name = trim(params[i].substr(0, eq));
      std::string_view value = eq == std::string_view::npos ? std::string_view() : trim(params[i].substr(eq + 1));
      if (value.size() >= 2 && value.front() == '"' && value.back() == '"') value = value.substr(1, value.size() - 2);
      auto bits = [&value]() -> int {
        if (value.empty() || value.size() > 2) return 0;
        int parsed = 0;
        for (char c : value) {
          if (c < '0' || c > '9') return 0;
          parsed = parsed * 10 + (c - '0');
        }
        return parsed >= 8 && parsed <= 15 ? parsed : 0;
      };
      if (equalsIgnoreCase(name, "server_no_context_takeover") && eq == std::string_view::npos && !seenServerNoContext) {
        seenServerNoContext = true;
        serverNoContextTakeover = true;
      } else if (equalsIgnoreCase(name, "client_no_context_takeover") && eq == std::string_view::npos && !seenClientNoContext) {
        seenClientNoContext = true;
        clientNoContextTakeover = true;
      } else if (equalsIgnoreCase(name, "server_max_window_bits") && !seenServerBits && bits() != 0) {
        seenServerBits = true;
      } else if (equalsIgnoreCase(name, "client_max_window_bits") && !seenClientBits && bits() != 0) {
        seenClientBits = true;
        clientWindowBits = bits();
      } else {
        return false;
      }
    }
    perMessageDeflate = true;
    return true;
  }

  void redirect(const std::string& location) {
    if (++redirects > kMaxRedirects) {
      finish(1006, "", false, "too many HTTP redirects");
      return;
    }
    NSString* target = [[NSString alloc] initWithBytes:location.data() length:location.size() encoding:NSUTF8StringEncoding];
    NSURL* next = target ? [NSURL URLWithString:target relativeToURL:url].absoluteURL : nil;
    if (!isValidTarget(next)) {
      finish(1006, "", false, "There was a bad response from the server.");
      return;
    }
    if (isSecureScheme(url.scheme) && !isSecureScheme(next.scheme)) {
      finish(1006, "", false, "Refused to follow a redirect from a secure to an insecure URL.");
      return;
    }
    extraHeaders.erase(std::remove_if(extraHeaders.begin(), extraHeaders.end(),
                                      [](const auto& field) { return equalsIgnoreCase(field.first, "Authorization"); }),
                       extraHeaders.end());
    nw_connection_cancel(connection);
    start(next);
  }

  void readFrames() {
    nw_connection_t current = connection;
    auto weak = weakSelf;
    nw_connection_receive(current, 1, kReadSize,
      ^(dispatch_data_t content, nw_content_context_t context, bool isComplete, nw_error_t error) {
        auto strong = weak.lock();
        if (!strong) return;
        Impl* impl = from(strong);
        if (impl->stopped) return;
        if (content) {
          dispatch_data_apply(content, ^bool(dispatch_data_t, size_t, const void* buffer, size_t size) {
            impl->consume(static_cast<const uint8_t*>(buffer), size);
            return !impl->stopped;
          });
          if (impl->stopped) return;
        }
        if (error) {
          impl->transportFailed(error);
        } else if (isComplete && (!context || nw_content_context_get_is_final(context))) {
          impl->transportClosed();
        } else {
          impl->readFrames();
        }
      });
  }

  void consume(const uint8_t* data, size_t size) {
    while (size > 0 && !stopped) {
      if (streamRemaining > 0) {
        const size_t take = std::min(size, streamRemaining);
        message.insert(message.end(), data, data + take);
        data += take;
        size -= take;
        streamRemaining -= take;
        if (streamRemaining == 0 && streamFin) finishMessage();
        continue;
      }
      if (!pendingFrame.empty()) {
        size_t needed;
        while ((needed = pendingFrameNeeds()) > 0 && size > 0) {
          const size_t take = std::min(size, needed);
          pendingFrame.insert(pendingFrame.end(), data, data + take);
          data += take;
          size -= take;
        }
        if (needed > 0) return;
        parseFrames(pendingFrame.data(), pendingFrame.size());
        if (stopped) return;
        pendingFrame.clear();
        continue;
      }
      const size_t used = parseFrames(data, size);
      if (stopped) return;
      data += used;
      size -= used;
      if (size > 0 && streamRemaining == 0) {
        pendingFrame.assign(data, data + size);
        return;
      }
    }
  }

  size_t pendingFrameNeeds() const {
    const size_t have = pendingFrame.size();
    if (have < 2) return 2 - have;
    const uint8_t length = pendingFrame[1] & 0x7F;
    const size_t header = length == 126 ? 4 : (length == 127 ? 10 : 2);
    if (have < header) return header - have;
    if (!(pendingFrame[0] & 0x08) || length > 125) return 0;
    return header + length > have ? header + length - have : 0;
  }

  size_t parseFrames(const uint8_t* data, size_t size) {
    size_t offset = 0;
    while (!stopped && size - offset >= 2) {
      const uint8_t* frame = data + offset;
      const size_t available = size - offset;
      const bool fin = frame[0] & kFin;
      const bool compressed = frame[0] & kRsv1;
      const uint8_t opcode = frame[0] & 0x0F;
      size_t header = 2;
      uint64_t length = frame[1] & 0x7F;
      if (length == 126) {
        if (available < 4) break;
        length = (static_cast<uint64_t>(frame[2]) << 8) | frame[3];
        header = 4;
      } else if (length == 127) {
        if (available < 10) break;
        length = 0;
        for (int i = 0; i < 8; i++) length = (length << 8) | frame[2 + i];
        header = 10;
      }
      if ((frame[1] & 0x80) || (frame[0] & 0x30)) {
        fail(1002, EPROTO);
        break;
      }
      if (opcode & 0x08) {
        if (!fin || compressed || (frame[1] & 0x7F) > 125 || opcode > kOpPong) {
          fail(1002, EPROTO);
          break;
        }
        if (available < header + length) break;
        controlFrame(opcode, frame + header, static_cast<size_t>(length));
        offset += header + static_cast<size_t>(length);
        continue;
      }
      if (opcode > kOpBinary || (opcode == kOpContinuation ? (!inMessage || compressed) : inMessage) ||
          (compressed && !perMessageDeflate)) {
        fail(1002, EPROTO);
        break;
      }
      const size_t base = opcode == kOpContinuation ? message.size() : 0;
      if (length > kMaxMessageSize - base) {
        fail(1009, EMSGSIZE);
        break;
      }
      if (opcode != kOpContinuation) {
        messageBinary = opcode == kOpBinary;
        messageCompressed = compressed;
      }
      const size_t len = static_cast<size_t>(length);
      if (available - header >= len) {
        dataFrame(opcode, fin, frame + header, len);
        offset += header + len;
        continue;
      }
      if (opcode != kOpContinuation) {
        message.clear();
        inMessage = true;
      }
      if (opcode != kOpContinuation) message.reserve(len);
      message.insert(message.end(), frame + header, data + size);
      streamRemaining = len - (available - header);
      streamFin = fin;
      return size;
    }
    return offset;
  }

  void dataFrame(uint8_t opcode, bool fin, const uint8_t* payload, size_t len) {
    if (opcode != kOpContinuation && fin && !messageCompressed) {
      if (!messageBinary && !isWellFormedUtf8(payload, len)) {
        fail(1007, EPROTO);
        return;
      }
      deliver(payload, len, messageBinary, nullptr);
      return;
    }
    if (opcode != kOpContinuation) {
      message.assign(payload, payload + len);
      inMessage = true;
    } else {
      message.insert(message.end(), payload, payload + len);
    }
    if (fin) finishMessage();
  }

  void finishMessage() {
    inMessage = false;
    std::vector<uint8_t> data = std::move(message);
    message = std::vector<uint8_t>();
    if (messageCompressed) {
      std::vector<uint8_t> inflated;
      if (!inflateMessage(data.data(), data.size(), inflated)) return;
      data = std::move(inflated);
    }
    if (!messageBinary && !isWellFormedUtf8(data.data(), data.size())) {
      fail(1007, EPROTO);
      return;
    }
    deliver(data.data(), data.size(), messageBinary, &data);
  }

  void deliver(const uint8_t* data, size_t len, bool isBinary, std::vector<uint8_t>* owned) {
    if (localClose) return;
#if defined(NITRO_WS_TRACING)
    os_signpost_event_emit(nitroWsLog(), signpost, "NitroWS", "receive %s %zu bytes", isBinary ? "binary" : "text", len);
#endif
    if (onMessage) {
      onMessage(data, len, isBinary, owned);
      return;
    }
    buffered.push_back({ owned ? std::move(*owned) : std::vector<uint8_t>(data, data + len), isBinary });
  }

  void controlFrame(uint8_t opcode, const uint8_t* payload, size_t len) {
    if (opcode == kOpPing) {
      if (!closeSent) sendFrame(makeFrame(kFin | kOpPong, payload, len));
      return;
    }
    if (opcode != kOpClose) return;

    int code = 1005;
    std::string reason;
    if (len == 1) {
      fail(1002, EPROTO);
      return;
    }
    if (len >= 2) {
      code = (payload[0] << 8) | payload[1];
      if (!isValidCloseCode(code)) {
        fail(1002, EPROTO);
        return;
      }
      if (!isWellFormedUtf8(payload + 2, len - 2)) {
        fail(1007, EPROTO);
        return;
      }
      reason.assign(reinterpret_cast<const char*>(payload + 2), len - 2);
    }
    stopped = true;
    if (closeSent) {
      finish(closeCode, closeReason, true, std::nullopt);
      return;
    }
    {
      std::lock_guard<std::mutex> lock(owner->_sendMu);
      State expected = State::OPEN;
      owner->_state.compare_exchange_strong(expected, State::CLOSING, std::memory_order_acq_rel);
    }
    closeCode = code;
    closeReason = reason;
    closeSent = true;
    selfRef = weakSelf.lock();
    const std::string echo = len >= 2 ? closePayload(code, "") : std::string();
    auto weak = weakSelf;
    sendFrame(makeFrame(kFin | kOpClose, reinterpret_cast<const uint8_t*>(echo.data()), echo.size()),
              ^(nw_error_t) {
                auto strong = weak.lock();
                if (!strong) return;
                Impl* impl = from(strong);
                impl->finish(impl->closeCode, impl->closeReason, true, std::nullopt);
              });
    armTimer(kCloseTimeout, std::nullopt);
  }

  void closeRequested(State previous, int code, const std::string& reason) {
    if (finished) return;
    if (previous == State::CONNECTING || !open) {
      finish(1006, "", false, std::nullopt);
      return;
    }
    if (closeSent) return;
    localClose = true;
    closeCode = code;
    closeReason = reason;
    closeSent = true;
    selfRef = weakSelf.lock();
    const std::string payload = isValidCloseCode(code) ? closePayload(code, reason) : std::string();
    auto weak = weakSelf;
    sendFrame(makeFrame(kFin | kOpClose, reinterpret_cast<const uint8_t*>(payload.data()), payload.size()),
              ^(nw_error_t error) {
                auto strong = weak.lock();
                if (!strong || error) return;
                from(strong)->closeWritten = true;
              });
    armTimer(kCloseTimeout, std::nullopt);
  }

  void fail(int code, int posixCode) {
    if (stopped) return;
    stopped = true;
    {
      std::lock_guard<std::mutex> lock(owner->_sendMu);
      State current = owner->_state.load(std::memory_order_acquire);
      if (current == State::CONNECTING || current == State::OPEN) {
        owner->_state.store(State::CLOSING, std::memory_order_release);
      }
    }
    failure = posixDescription(posixCode);
    if (closeSent || !open) {
      finish(1006, "", false, failure);
      return;
    }
    closeSent = true;
    selfRef = weakSelf.lock();
    const std::string payload = closePayload(code, "");
    auto weak = weakSelf;
    sendFrame(makeFrame(kFin | kOpClose, reinterpret_cast<const uint8_t*>(payload.data()), payload.size()),
              ^(nw_error_t) {
                auto strong = weak.lock();
                if (!strong) return;
                Impl* impl = from(strong);
                impl->finish(1006, "", false, impl->failure);
              });
    armTimer(kCloseTimeout, failure);
  }

  void transportFailed(nw_error_t error) {
    if (failure) {
      finish(1006, "", false, failure);
      return;
    }
    if (closeSent) {
      closedAfterCloseSent();
      return;
    }
    if (open) {
      finish(1006, "", false, errorDescription(error, ENOTCONN));
    } else if (connected) {
      finish(1006, "", false, handshake.empty() ? "The network connection was lost." : "cannot parse response");
    } else {
      finish(1006, "", false, connectErrorDescription(error, url.host));
    }
  }

  void transportClosed() {
    if (failure) {
      finish(1006, "", false, failure);
      return;
    }
    if (closeSent) {
      closedAfterCloseSent();
      return;
    }
    finish(1006, "", false, posixDescription(ENOTCONN));
  }

  void closedAfterCloseSent() {
    if (closeWritten) {
      finish(closeCode, closeReason, true, std::nullopt);
    } else {
      finish(1006, "", false, std::nullopt);
    }
  }

  void finish(int code, const std::string& reason, bool wasClean, const std::optional<std::string>& error) {
    if (finished) return;
    finished = true;
    stopped = true;
    cancelTimer();
    {
      std::lock_guard<std::mutex> lock(owner->_sendMu);
      owner->_state.store(State::CLOSED, std::memory_order_release);
    }
    if (connection) nw_connection_cancel(connection);
    releaseCompression();
    pendingFrame = std::vector<uint8_t>();
    message = std::vector<uint8_t>();
#if defined(NITRO_WS_TRACING)
    os_signpost_event_emit(nitroWsLog(), signpost, "NitroWS", "close code=%d clean=%d", code, wasClean ? 1 : 0);
#endif
    if (error) {
      if (onError) onError(*error);
      else errorPending = *error;
    }
    if (onClose) onClose(code, reason, wasClean);
    else closePending = PendingClose{ code, reason, wasClean };
    auto keepAlive = std::move(selfRef);
  }

  void sendFrame(dispatch_data_t frame, void (^completion)(nw_error_t) = nil) {
    nw_connection_send(connection, frame, NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, true, ^(nw_error_t error) {
      if (completion) completion(error);
    });
  }

  void sendData(uint8_t opcode, const std::vector<uint8_t>& payload) {
    const size_t len = payload.size();
    if (closeSent || finished) {
      owner->_bufferedAmount.fetch_sub(len, std::memory_order_relaxed);
      return;
    }
    dispatch_data_t frame = nil;
    if (len >= kMinDeflateSize && clientWindowBits > 8) {
      std::vector<uint8_t> compressed;
      if (!deflateMessage(payload, compressed)) {
        owner->_bufferedAmount.fetch_sub(len, std::memory_order_relaxed);
        fail(1011, EPROTO);
        return;
      }
      frame = makeFrame(kFin | kRsv1 | opcode, compressed.data(), compressed.size());
    } else {
      frame = makeFrame(kFin | opcode, payload.data(), len);
    }
    auto weak = weakSelf;
    sendFrame(frame, ^(nw_error_t) {
      if (auto strong = weak.lock()) {
        static_cast<NWStreamWebSocketConnection*>(strong.get())->_bufferedAmount.fetch_sub(len, std::memory_order_relaxed);
      }
    });
  }

  bool inflateMessage(const uint8_t* data, size_t len, std::vector<uint8_t>& out) {
    if (!inflater) {
      inflater = new z_stream();
      if (inflateInit2(inflater, -MAX_WBITS) != Z_OK) {
        delete inflater;
        inflater = nullptr;
        fail(1011, EPROTO);
        return false;
      }
    }
    static constexpr uint8_t kTail[] = { 0x00, 0x00, 0xFF, 0xFF };
    const uint8_t* inputs[] = { data, kTail };
    const size_t sizes[] = { len, sizeof(kTail) };
    out.resize(std::min(std::max<size_t>(len * 2, 1024), kMaxMessageSize + 1));
    size_t produced = 0;
    bool ended = false;
    for (int part = 0; part < 2 && !ended; part++) {
      inflater->next_in = const_cast<Bytef*>(inputs[part]);
      inflater->avail_in = static_cast<uInt>(sizes[part]);
      while (inflater->avail_in > 0) {
        if (produced == out.size()) {
          if (out.size() > kMaxMessageSize) {
            fail(1009, EMSGSIZE);
            return false;
          }
          out.resize(std::min(out.size() * 2, kMaxMessageSize + 1));
        }
        inflater->next_out = out.data() + produced;
        inflater->avail_out = static_cast<uInt>(out.size() - produced);
        const int result = inflate(inflater, Z_SYNC_FLUSH);
        produced = out.size() - inflater->avail_out;
        if (result == Z_STREAM_END) {
          inflateReset(inflater);
          ended = true;
          break;
        }
        if (result != Z_OK && !(result == Z_BUF_ERROR && inflater->avail_out == 0)) {
          fail(1007, EPROTO);
          return false;
        }
      }
    }
    if (produced > kMaxMessageSize) {
      fail(1009, EMSGSIZE);
      return false;
    }
    out.resize(produced);
    if (serverNoContextTakeover && !ended) inflateReset(inflater);
    return true;
  }

  bool deflateMessage(const std::vector<uint8_t>& in, std::vector<uint8_t>& out) {
    if (!deflater) {
      deflater = new z_stream();
      if (deflateInit2(deflater, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -clientWindowBits, 8, Z_DEFAULT_STRATEGY) != Z_OK) {
        delete deflater;
        deflater = nullptr;
        return false;
      }
    }
    out.resize(deflateBound(deflater, static_cast<uLong>(in.size())) + 16);
    deflater->next_in = const_cast<Bytef*>(in.data());
    deflater->avail_in = static_cast<uInt>(in.size());
    size_t produced = 0;
    while (true) {
      deflater->next_out = out.data() + produced;
      deflater->avail_out = static_cast<uInt>(out.size() - produced);
      const int result = deflate(deflater, Z_SYNC_FLUSH);
      if (result != Z_OK && result != Z_BUF_ERROR) return false;
      produced = out.size() - deflater->avail_out;
      if (deflater->avail_out > 0) break;
      out.resize(out.size() * 2);
    }
    if (produced < 4) return false;
    out.resize(produced - 4);
    if (clientNoContextTakeover) deflateReset(deflater);
    return true;
  }

  void releaseCompression() {
    if (inflater) {
      inflateEnd(inflater);
      delete inflater;
      inflater = nullptr;
    }
    if (deflater) {
      deflateEnd(deflater);
      delete deflater;
      deflater = nullptr;
    }
  }

  void armTimer(int64_t delay, const std::optional<std::string>& error) {
    const uint64_t generation = ++timerGeneration;
    auto weak = weakSelf;
    std::optional<std::string> timeoutError = error;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delay), queue, ^{
      auto strong = weak.lock();
      if (!strong) return;
      Impl* impl = from(strong);
      if (impl->timerGeneration != generation || impl->finished) return;
      impl->finish(1006, "", false, timeoutError);
    });
  }

  void cancelTimer() { ++timerGeneration; }
};


NWStreamWebSocketConnection::NWStreamWebSocketConnection()
  : _impl(std::make_unique<Impl>(this)) {}

NWStreamWebSocketConnection::~NWStreamWebSocketConnection() = default;


void NWStreamWebSocketConnection::connect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {
  {
    std::lock_guard<std::mutex> lock(_strMu);
    _url = url;
    _negotiatedProtocol.clear();
    _extensions.clear();
  }
  _state.store(State::CONNECTING, std::memory_order_release);

  NSString* urlString = [[NSString alloc] initWithBytes:url.data() length:url.size() encoding:NSUTF8StringEncoding];
  NSURL* target = urlString ? [NSURL URLWithString:urlString] : nil;
  std::string joined;
  for (size_t i = 0; i < protocols.size(); i++) {
    if (i > 0) joined += ", ";
    joined += protocols[i];
  }
  Fields fields(headers.begin(), headers.end());

  auto self = shared_from_this();
  Impl* impl = _impl.get();
#if defined(NITRO_WS_TRACING)
  impl->signpost = os_signpost_id_generate(nitroWsLog());
  os_signpost_interval_begin(nitroWsLog(), impl->signpost, "NitroWS", "%{public}s", url.c_str());
#endif
  dispatch_async(impl->queue, ^{
    impl->begin(self, target, joined, fields);
  });
}


void NWStreamWebSocketConnection::close(int code, const std::string& reason) {
  State previous;
  {
    std::lock_guard<std::mutex> lock(_sendMu);
    previous = _state.load(std::memory_order_acquire);
    if (previous == State::CLOSING || previous == State::CLOSED) return;
    _state.store(State::CLOSING, std::memory_order_release);
  }
  const int closeCode = (code >= 1000 && code <= 4999) ? code : 1000;
  std::string closeReason = reason;
  auto self = shared_from_this();
  Impl* impl = _impl.get();
  dispatch_async(impl->queue, ^{
    (void)self;
    impl->closeRequested(previous, closeCode, closeReason);
  });
}


void NWStreamWebSocketConnection::send(const std::string& data) {
  sendMessage(kOpText, reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

void NWStreamWebSocketConnection::sendBinary(const uint8_t* data, size_t len) {
  sendMessage(kOpBinary, data, len);
}

void NWStreamWebSocketConnection::sendMessage(uint8_t opcode, const uint8_t* data, size_t len) {
  if (_state.load(std::memory_order_acquire) != State::OPEN) return;
  Impl* impl = _impl.get();
#if defined(NITRO_WS_TRACING)
  os_signpost_event_emit(nitroWsLog(), impl->signpost, "NitroWS", "send %s %zu bytes",
                         opcode == kOpText ? "text" : "binary", len);
#endif

  if (impl->perMessageDeflate) {
    auto payload = std::make_shared<std::vector<uint8_t>>(data, data + len);
    {
      std::lock_guard<std::mutex> lock(_sendMu);
      if (_state.load(std::memory_order_relaxed) != State::OPEN) return;
      _bufferedAmount.fetch_add(len, std::memory_order_relaxed);
    }
    auto self = shared_from_this();
    dispatch_async(impl->queue, ^{
      (void)self;
      impl->sendData(opcode, *payload);
    });
    return;
  }

  dispatch_data_t frame = makeFrame(kFin | opcode, data, len);
  std::weak_ptr<WebSocketConnectionBase> weak = weak_from_this();
  std::lock_guard<std::mutex> lock(_sendMu);
  if (_state.load(std::memory_order_relaxed) != State::OPEN) return;
  _bufferedAmount.fetch_add(len, std::memory_order_relaxed);
  nw_connection_send(impl->connection, frame, NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, true, ^(nw_error_t) {
    if (auto strong = weak.lock()) {
      static_cast<NWStreamWebSocketConnection*>(strong.get())->_bufferedAmount.fetch_sub(len, std::memory_order_relaxed);
    }
  });
}


void NWStreamWebSocketConnection::setOnOpen(OnOpen cb) {
  auto self = shared_from_this();
  Impl* impl = _impl.get();
  dispatch_async(impl->queue, ^{
    (void)self;
    impl->onOpen = cb;
    if (impl->onOpen && impl->openPending) {
      impl->openPending = false;
      impl->onOpen();
    }
  });
}

void NWStreamWebSocketConnection::setOnMessage(OnMessage cb) {
  auto self = shared_from_this();
  Impl* impl = _impl.get();
  dispatch_async(impl->queue, ^{
    (void)self;
    impl->onMessage = cb;
    while (impl->onMessage && !impl->buffered.empty()) {
      BufferedMessage next = std::move(impl->buffered.front());
      impl->buffered.pop_front();
      impl->onMessage(next.data.data(), next.data.size(), next.isBinary, &next.data);
    }
  });
}

void NWStreamWebSocketConnection::setOnClose(OnClose cb) {
  auto self = shared_from_this();
  Impl* impl = _impl.get();
  dispatch_async(impl->queue, ^{
    (void)self;
    impl->onClose = cb;
    if (impl->onClose && impl->closePending) {
      Impl::PendingClose pending = std::move(*impl->closePending);
      impl->closePending.reset();
      impl->onClose(pending.code, pending.reason, pending.wasClean);
    }
  });
}

void NWStreamWebSocketConnection::setOnError(OnError cb) {
  auto self = shared_from_this();
  Impl* impl = _impl.get();
  dispatch_async(impl->queue, ^{
    (void)self;
    impl->onError = cb;
    if (impl->onError && impl->errorPending) {
      std::string pending = std::move(*impl->errorPending);
      impl->errorPending.reset();
      impl->onError(pending);
    }
  });
}


std::string NWStreamWebSocketConnection::url() const {
  std::lock_guard<std::mutex> lock(_strMu);
  return _url;
}

std::string NWStreamWebSocketConnection::protocol() const {
  std::lock_guard<std::mutex> lock(_strMu);
  return _negotiatedProtocol;
}

std::string NWStreamWebSocketConnection::extensions() const {
  std::lock_guard<std::mutex> lock(_strMu);
  return _extensions;
}


std::shared_ptr<WebSocketConnectionBase> createNWStreamConnection() {
  return std::make_shared<NWStreamWebSocketConnection>();
}

} // namespace margelo::nitro::nitrofetchwebsockets
