// C++ core for NitroFetch – Cronet-driven implementation scaffolding.
// Implements classes declared in nitrofetch.hpp

#include <jni.h>
#include <string>
#include <memory>
#include <stdexcept>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>
#include <android/log.h>
#include <fbjni/fbjni.h>
#define TAG "NitroFetch"

#include "nitrofetch.hpp"

#if (__has_include(<cronet_c.h>) && __has_include(<cronet.idl_c.h>))
  #include <cronet_c.h>
  #include <cronet.idl_c.h>
  #define HAVE_CRONET_HEADER 1
#elif (__has_include(<cronet/cronet_c.h>) && __has_include(<cronet/cronet.idl_c.h>))
  #include <cronet/cronet_c.h>
  #include <cronet/cronet.idl_c.h>
  #define HAVE_CRONET_HEADER 1
#else
  #define HAVE_CRONET_HEADER 0
#endif

#if defined(NITROFETCH_LINKS_CRONET) && NITROFETCH_LINKS_CRONET && HAVE_CRONET_HEADER
  #define NITROFETCH_HAS_CRONET 1
#else
  #define NITROFETCH_HAS_CRONET 0
#endif

namespace margelo::nitro::nitrofetch {

using namespace margelo::nitro;

#if NITROFETCH_HAS_CRONET
struct CronetEngineHolder {
  Cronet_EnginePtr engine{nullptr};
  bool ownsEngine{false};

  // Adopt an already-started engine (from Java CronetEngine)
  explicit CronetEngineHolder(Cronet_EnginePtr existingEngine) : engine(existingEngine), ownsEngine(false) {}

  ~CronetEngineHolder() {
    if (engine && ownsEngine) {
      Cronet_Engine_Shutdown(engine);
      Cronet_Engine_Destroy(engine);
      engine = nullptr;
    }
  }
};

// Global engine holder optionally initialized from Java main thread
static std::shared_ptr<CronetEngineHolder> g_engineHolder;

extern "C" JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_nitrofetch_CronetBootstrap_nativeAdoptCronetEngine(JNIEnv* env, jclass, jlong enginePtr) {
  try {
    Cronet_EnginePtr ptr = reinterpret_cast<Cronet_EnginePtr>(enginePtr);
    if (ptr == nullptr) return JNI_FALSE;
    g_engineHolder.reset();
    g_engineHolder = std::make_shared<CronetEngineHolder>(ptr);
    __android_log_print(ANDROID_LOG_INFO, TAG, "Adopted Java CronetEngine (ptr=%p)", ptr);
    return JNI_TRUE;
  } catch (...) {
    g_engineHolder.reset();
    return JNI_FALSE;
  }
}
#endif

// ---- CppNitroFetchClient ----

CppNitroFetchClient::CppNitroFetchClient() = default;
CppNitroFetchClient::CppNitroFetchClient(std::shared_ptr<CronetEngineHolder> holder)
  : _holder(std::move(holder)) {}

std::shared_ptr<Promise<NitroResponse>> CppNitroFetchClient::request(const NitroRequest& /*req*/)
{
  // TODO: Implement using Cronet C API; for now throw to signal JS fallback.
  throw std::runtime_error("CppNitroFetchClient.request not implemented yet");
}

// ---- CppNitroFetch ----

CppNitroFetch::CppNitroFetch() : HybridObject(TAG) {}

std::shared_ptr<HybridNitroFetchClientSpec> CppNitroFetch::createClient(const std::optional<std::shared_ptr<HybridNitroEnvSpec>>& env)
{
#if NITROFETCH_HAS_CRONET
  std::string cacheDir;
  if (env.has_value() && env.value()) {
    try {
      cacheDir = env.value()->getCacheDir();
    } catch (...) {
      cacheDir = "";
    }
  }
  // Prefer new flow: ask NitroEnv to create Cronet engine and adopt in native
  bool adopted = false;
  try {
    if (env.has_value() && env.value()) {
      __android_log_print(ANDROID_LOG_INFO, TAG, "Attempting NitroEnv.createCronetEngine with cacheDir='%s'", cacheDir.c_str());
      // After codegen, this method will exist
      adopted = env.value()->createCronetEngine(cacheDir);
      __android_log_print(ANDROID_LOG_INFO, TAG, "NitroEnv.createCronetEngine returned %s", adopted ? "true" : "false");
    }
  } catch (...) {
    adopted = false;
  }
  if (!adopted) {
    // Fallback to legacy bootstrap
    try {
      JNIEnv* jni = facebook::jni::Environment::current();
      jclass cls = jni->FindClass("com/margelo/nitro/nitrofetch/CronetBootstrap");
      if (cls != nullptr) {
        jmethodID mid = jni->GetStaticMethodID(cls, "ensureInitialized", "(Ljava/lang/String;)Z");
        if (mid != nullptr) {
          jstring jPath = jni->NewStringUTF(cacheDir.c_str());
          __android_log_print(ANDROID_LOG_INFO, TAG, "CronetBootstrap.ensureInitialized fallback invoked");
          jboolean ok = jni->CallStaticBooleanMethod(cls, mid, jPath);
          jni->DeleteLocalRef(jPath);
          (void)ok;
        }
      }
    } catch (...) {
      __android_log_print(ANDROID_LOG_WARN, TAG, "Cronet bootstrap via Java failed (JNI)");
    }
  }
  // Prefer the bootstrapped engine if available
  if (g_engineHolder) {
    __android_log_print(ANDROID_LOG_INFO, TAG, "Using adopted Cronet engine for client");
    return std::make_shared<CppNitroFetchClient>(g_engineHolder);
  }
  // No engine available – do not create one from C++.
  // Return a client without an engine so JS wrapper can fallback.
  __android_log_print(ANDROID_LOG_WARN, TAG, "No Cronet engine available from Java/NitroEnv; returning inert client");
  return std::make_shared<CppNitroFetchClient>();
#else
  return std::make_shared<CppNitroFetchClient>();
#endif
}

} // namespace margelo::nitro::nitrofetch
