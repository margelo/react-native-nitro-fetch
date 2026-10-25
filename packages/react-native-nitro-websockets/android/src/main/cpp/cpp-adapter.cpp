#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroFetchWebsocketsOnLoad.hpp"
#include "WebSocketConnection.hpp"
#include "WebSocketPrewarmer.hpp"

#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

struct JNitroWSPinning : facebook::jni::JavaClass<JNitroWSPinning> {
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitrofetchwebsockets/NitroWSPinning;";
};

} // namespace

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitrofetchwebsockets::registerAllNatives();
    // Looked up now: the lws service thread that calls it can't find app classes. If it is
    // missing, the library still loads and checkPinnedChain() fails every wss:// connection.
    try {
      JNitroWSPinning::javaClassStatic();
    } catch (const std::exception&) {
    }
  });
}

namespace margelo::nitro::nitrofetchwebsockets {

void warmUpPins() {
  static std::once_flag once;
  std::call_once(once, [] {
    try {
      const auto cls = JNitroWSPinning::javaClassStatic();
      cls->getStaticMethod<void()>("warmUp")(cls);
    } catch (const std::exception&) {
      // The first pinned handshake then sets the pins up itself.
    }
  });
}

bool hasPins() {
  static const bool pins = [] {
    try {
      const auto cls = JNitroWSPinning::javaClassStatic();
      return cls->getStaticMethod<jboolean()>("hasPins")(cls) != JNI_FALSE;
    } catch (const std::exception&) {
      return true; // Can't tell, so every connection is checked (and fails closed).
    }
  }();
  return pins;
}

std::optional<std::string> checkPinnedChain(const std::string& host, int port,
                                            const std::function<std::vector<std::string_view>()>& chain) {
  if (!hasPins()) return std::nullopt;
  if (host.empty()) return std::string("Certificate pinning check failed: unknown host");
  namespace jni = facebook::jni;
  try {
    const auto cls = JNitroWSPinning::javaClassStatic();
    static const auto isPinned = cls->getStaticMethod<jboolean(jstring)>("isPinned");
    static const auto check =
      cls->getStaticMethod<jstring(jstring, jint, jni::jtypeArray<jbyteArray>)>("checkServerTrusted");
    const auto jhost = jni::make_jstring(host);
    if (!isPinned(cls, jhost.get())) return std::nullopt;
    const auto certs = chain();
    if (certs.empty()) return "Certificate pinning failed for " + host + ": can't read the server's certificate chain";
    auto array = jni::JArrayClass<jbyteArray>::newArray(certs.size());
    for (size_t i = 0; i < certs.size(); i++) {
      auto der = jni::JArrayByte::newArray(certs[i].size());
      der->setRegion(0, static_cast<jsize>(certs[i].size()), reinterpret_cast<const jbyte*>(certs[i].data()));
      array->setElement(i, der.get());
    }
    auto error = check(cls, jhost.get(), static_cast<jint>(port), array.get());
    if (!error) return std::nullopt;
    return error->toStdString();
  } catch (const std::exception& e) {
    // Without the check the pins can't be enforced, so fail rather than connect unpinned.
    return "Certificate pinning check failed for " + host + ": " + e.what();
  }
}

} // namespace margelo::nitro::nitrofetchwebsockets

/**
 * Called from NitroWebSocketPrewarmer.kt (which can be invoked from
 * Application.onCreate) to start a WebSocket connection before React Native
 * is initialized. The live connection is adopted by HybridWebSocket::connect()
 * when JS eventually creates the matching WebSocket.
 */
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_nitrofetchwebsockets_NitroWebSocketPrewarmer_nativePreWarm(
    JNIEnv* env, jclass, jstring urlJs, jobjectArray protocolsJs, jobjectArray headersJs) {

  const char* urlCStr = env->GetStringUTFChars(urlJs, nullptr);
  std::string url(urlCStr);
  env->ReleaseStringUTFChars(urlJs, urlCStr);

  std::vector<std::string> protocols;
  if (protocolsJs != nullptr) {
    jsize count = env->GetArrayLength(protocolsJs);
    for (jsize i = 0; i < count; ++i) {
      auto item = static_cast<jstring>(env->GetObjectArrayElement(protocolsJs, i));
      const char* s = env->GetStringUTFChars(item, nullptr);
      protocols.emplace_back(s);
      env->ReleaseStringUTFChars(item, s);
      env->DeleteLocalRef(item);
    }
  }

  std::unordered_map<std::string, std::string> headers;
  if (headersJs != nullptr) {
    jsize count = env->GetArrayLength(headersJs);
    for (jsize i = 0; i + 1 < count; i += 2) {
      auto keyJs = static_cast<jstring>(env->GetObjectArrayElement(headersJs, i));
      auto valJs = static_cast<jstring>(env->GetObjectArrayElement(headersJs, i + 1));
      const char* k = env->GetStringUTFChars(keyJs, nullptr);
      const char* v = env->GetStringUTFChars(valJs, nullptr);
      headers[k] = v;
      env->ReleaseStringUTFChars(keyJs, k);
      env->ReleaseStringUTFChars(valJs, v);
      env->DeleteLocalRef(keyJs);
      env->DeleteLocalRef(valJs);
    }
  }

  margelo::nitro::nitrofetchwebsockets::WebSocketPrewarmer::instance()
    .preConnect(url, protocols, headers);
}
