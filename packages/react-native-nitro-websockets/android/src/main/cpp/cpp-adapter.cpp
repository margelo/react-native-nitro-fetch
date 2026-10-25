#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroFetchWebsocketsOnLoad.hpp"
#include "WebSocketConnection.hpp"
#include "WebSocketPrewarmer.hpp"

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
    // Looked up now: the lws service thread that calls it can't find app classes.
    JNitroWSPinning::javaClassStatic();
  });
}

namespace margelo::nitro::nitrofetchwebsockets {

std::optional<std::string> checkPinnedChain(const std::string& host, const std::vector<std::string_view>& chain) {
  namespace jni = facebook::jni;
  try {
    static const auto check = JNitroWSPinning::javaClassStatic()
      ->getStaticMethod<jstring(jstring, jni::jtypeArray<jbyteArray>)>("checkServerTrusted");
    auto certs = jni::JArrayClass<jbyteArray>::newArray(chain.size());
    for (size_t i = 0; i < chain.size(); i++) {
      auto der = jni::JArrayByte::newArray(chain[i].size());
      der->setRegion(0, static_cast<jsize>(chain[i].size()), reinterpret_cast<const jbyte*>(chain[i].data()));
      certs->setElement(i, der.get());
    }
    auto error = check(JNitroWSPinning::javaClassStatic(), jni::make_jstring(host).get(), certs.get());
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
