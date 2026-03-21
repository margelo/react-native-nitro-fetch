#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroFetchWebsocketsOnLoad.hpp"
#include "WebSocketPrewarmer.hpp"

#include <string>
#include <vector>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitrofetchwebsockets::registerAllNatives();
  });
}

/**
 * Called from NitroWebSocketPrewarmer.kt (which can be invoked from
 * Application.onCreate) to start a WebSocket connection before React Native
 * is initialized. The live connection is adopted by HybridWebSocket::connect()
 * when JS eventually creates the matching WebSocket.
 */
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_nitrofetchwebsockets_NitroWebSocketPrewarmer_nativePreWarm(
    JNIEnv* env, jclass, jstring urlJs, jobjectArray protocolsJs) {

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

  margelo::nitro::nitrofetchwebsockets::WebSocketPrewarmer::instance()
    .preConnect(url, protocols, {});
}
