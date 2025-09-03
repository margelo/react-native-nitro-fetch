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
namespace {
struct RequestCtx {
  std::shared_ptr<Promise<NitroResponse>> promise;
  std::vector<uint8_t> body;
  std::string finalUrl;
  int status = 0;
  std::string statusText;
  std::vector<std::tuple<std::string,std::string>> headers;
  Cronet_UrlRequestPtr request{nullptr};
  Cronet_BufferPtr buffer{nullptr};
  Cronet_UrlRequestCallbackPtr callback{nullptr};
  Cronet_ExecutorPtr executor{nullptr};
};

static const char* safe_str(const char* s) { return s ? s : ""; }

    static std::string base64Encode(const std::vector<uint8_t>& data) {
        static const char b64[] =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string out;
        out.reserve(((data.size() + 2) / 3) * 4);

        uint32_t val = 0;
        int valb = -6;
        for (uint8_t c : data) {
            val = (val << 8) + c;
            valb += 8;
            while (valb >= 0) {
                out.push_back(b64[(val >> valb) & 0x3F]);
                valb -= 6;
            }
        }
        if (valb > -6) out.push_back(b64[((val << 8) >> (valb + 8)) & 0x3F]);
        while (out.size() % 4) out.push_back('=');
        return out;
    }

static void cleanup(RequestCtx* c) {
  if (!c) return;
  // Detach client context from callback first to prevent any late callback from dereferencing freed memory.
  if (c->callback) {
    Cronet_UrlRequestCallback_SetClientContext(c->callback, nullptr);
  }
  // Destroy request first to stop further callbacks.
  if (c->request) { Cronet_UrlRequest_Destroy(c->request); c->request = nullptr; }
  // Now it is safe to dispose buffer and callback/executor.
  if (c->buffer)  { Cronet_Buffer_Destroy(c->buffer); c->buffer = nullptr; }
  if (c->callback){ Cronet_UrlRequestCallback_Destroy(c->callback); c->callback = nullptr; }
  if (c->executor){ Cronet_Executor_Destroy(c->executor); c->executor = nullptr; }
  delete c;
}

// Executor
static void ExecRun(Cronet_ExecutorPtr /*self*/, Cronet_RunnablePtr command) {
  try {
    Cronet_Runnable_Run(command);
  } catch (...) {
    __android_log_print(ANDROID_LOG_ERROR, TAG, "Executor runnable threw; swallowed to protect Cronet");
  }
}

// Callbacks
static void OnRedirect(Cronet_UrlRequestCallbackPtr cb, Cronet_UrlRequestPtr request, Cronet_UrlResponseInfoPtr /*info*/, Cronet_String /*url*/) {
  Cronet_UrlRequest_FollowRedirect(request);
}
static void OnStarted(Cronet_UrlRequestCallbackPtr cb, Cronet_UrlRequestPtr request, Cronet_UrlResponseInfoPtr info) {
  auto* c = static_cast<RequestCtx*>(Cronet_UrlRequestCallback_GetClientContext(cb));
  if (!c) return;
  const char* url = Cronet_UrlResponseInfo_url_get(info);
  c->finalUrl = safe_str(url);
  c->status = Cronet_UrlResponseInfo_http_status_code_get(info);
  const char* st = Cronet_UrlResponseInfo_http_status_text_get(info);
  if (st) c->statusText = st;
  uint32_t hsz = Cronet_UrlResponseInfo_all_headers_list_size(info);
  for (uint32_t i = 0; i < hsz; i++) {
    Cronet_HttpHeaderPtr h = Cronet_UrlResponseInfo_all_headers_list_at(info, i);
    if (!h) continue;
    const char* hn = Cronet_HttpHeader_name_get(h);
    const char* hv = Cronet_HttpHeader_value_get(h);
    c->headers.emplace_back(safe_str(hn), safe_str(hv));
  }
  if (!c->buffer) {
    c->buffer = Cronet_Buffer_Create();
    Cronet_Buffer_InitWithAlloc(c->buffer, 16 * 1024);
  }
  Cronet_UrlRequest_Read(request, c->buffer);
}
static void OnRead(Cronet_UrlRequestCallbackPtr cb, Cronet_UrlRequestPtr request, Cronet_UrlResponseInfoPtr /*info*/, Cronet_BufferPtr buffer, uint64_t bytes_read) {
  auto* c = static_cast<RequestCtx*>(Cronet_UrlRequestCallback_GetClientContext(cb));
  if (!c) return;
  if (bytes_read == 0) {
    // EOF; Cronet will invoke OnSucceeded/OnFailed next.
    return;
  }
  uint8_t* data = static_cast<uint8_t*>(Cronet_Buffer_GetData(buffer));
  if (data && bytes_read > 0) {
    c->body.insert(c->body.end(), data, data + bytes_read);
  }
  Cronet_UrlRequest_Read(request, buffer);
}
static void OnSucceeded(Cronet_UrlRequestCallbackPtr cb, Cronet_UrlRequestPtr /*req*/, Cronet_UrlResponseInfoPtr /*info*/) {
  auto* c = static_cast<RequestCtx*>(Cronet_UrlRequestCallback_GetClientContext(cb));
  if (!c) return;
  NitroResponse res;
  res.url = c->finalUrl;
  res.status = static_cast<double>(c->status);
  res.statusText = c->statusText;
  res.ok = (c->status >= 200 && c->status < 300);
  res.redirected = false;
  res.headers = c->headers;
  res.bodyBase64 = base64Encode(c->body);
  if (c->promise) c->promise->resolve(res);
  cleanup(c);
}
static void OnFailed(Cronet_UrlRequestCallbackPtr cb, Cronet_UrlRequestPtr /*req*/, Cronet_UrlResponseInfoPtr /*info*/, Cronet_ErrorPtr /*err*/) {
  auto* c = static_cast<RequestCtx*>(Cronet_UrlRequestCallback_GetClientContext(cb));
  if (!c) return;
  __android_log_print(ANDROID_LOG_ERROR, TAG, "Cronet request failed (OnFailed)");
  if (c->promise) {
    try {
      c->promise->reject(std::make_exception_ptr(std::runtime_error("Cronet request failed")));
    } catch (...) {
      // ignore
    }
  }
  cleanup(c);
}
static void OnCanceled(Cronet_UrlRequestCallbackPtr cb, Cronet_UrlRequestPtr /*req*/, Cronet_UrlResponseInfoPtr /*info*/) {
  auto* c = static_cast<RequestCtx*>(Cronet_UrlRequestCallback_GetClientContext(cb));
  if (!c) return;
  if (c->promise) c->promise->reject(std::make_exception_ptr(std::runtime_error("Cronet request canceled")));
  cleanup(c);
}
} // namespace
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
    const char* ver = Cronet_Engine_GetVersionString(ptr);
    __android_log_print(ANDROID_LOG_INFO, TAG, "Cronet native version: %s", safe_str(ver));
    return JNI_TRUE;
  } catch (...) {
    g_engineHolder.reset();
    return JNI_FALSE;
  }
}
#endif

// ---- CppNitroFetchClient ----

CppNitroFetchClient::CppNitroFetchClient() : HybridObject(TAG) {}
CppNitroFetchClient::CppNitroFetchClient(std::shared_ptr<CronetEngineHolder> holder)
  : HybridObject(TAG), _holder(std::move(holder)) {}

std::shared_ptr<Promise<NitroResponse>> CppNitroFetchClient::request(const NitroRequest& req)
{
  using namespace std;
#if !NITROFETCH_HAS_CRONET
  throw std::runtime_error("Cronet not linked");
#else
  if (!_holder || !_holder->engine) {
    throw std::runtime_error("No Cronet engine available");
  }
  __android_log_print(ANDROID_LOG_INFO, TAG, "Cronet engine ptr=%p version=%s", (void*)_holder->engine, safe_str(Cronet_Engine_GetVersionString(_holder->engine)));

  auto* ctx = new RequestCtx();
  auto resultPromise = Promise<NitroResponse>::create();
  ctx->promise = resultPromise;
  ctx->executor = Cronet_Executor_CreateWith(ExecRun);
  ctx->callback = Cronet_UrlRequestCallback_CreateWith(
      OnRedirect, OnStarted, OnRead, OnSucceeded, OnFailed, OnCanceled);
  Cronet_UrlRequestCallback_SetClientContext(ctx->callback, ctx);

  // Build params
  Cronet_UrlRequestParamsPtr params = Cronet_UrlRequestParams_Create();
  // Method
  const char* method = "GET";
  if (req.method.has_value()) {
    switch (req.method.value()) {
      case NitroRequestMethod::GET: method = "GET"; break;
      case NitroRequestMethod::HEAD: method = "HEAD"; break;
      case NitroRequestMethod::POST: method = "POST"; break;
      case NitroRequestMethod::PUT: method = "PUT"; break;
      case NitroRequestMethod::PATCH: method = "PATCH"; break;
      case NitroRequestMethod::DELETE: method = "DELETE"; break;
      case NitroRequestMethod::OPTIONS: method = "OPTIONS"; break;
    }
  }
  Cronet_UrlRequestParams_http_method_set(params, method);
  // Execute callbacks inline to simplify threading for MVP
  Cronet_UrlRequestParams_allow_direct_executor_set(params, true);
  // Headers
  if (req.headers.has_value()) {
    for (const auto& t : req.headers.value()) {
      Cronet_HttpHeaderPtr h = Cronet_HttpHeader_Create();
      Cronet_HttpHeader_name_set(h, std::get<0>(t).c_str());
      Cronet_HttpHeader_value_set(h, std::get<1>(t).c_str());
      Cronet_UrlRequestParams_request_headers_add(params, h);
      Cronet_HttpHeader_Destroy(h);
    }
  }

  // Create and start request
  ctx->request = Cronet_UrlRequest_Create();
  __android_log_print(ANDROID_LOG_INFO, TAG,
                      "Cronet InitWithParams url=%s method=%s engine=%p",
                      req.url.c_str(), method, (void*)_holder->engine);
  Cronet_RESULT rc = Cronet_UrlRequest_InitWithParams(
      ctx->request,
      _holder->engine,
      /*url*/ req.url.c_str(),
      params,
      ctx->callback,
      ctx->executor);
  Cronet_UrlRequestParams_Destroy(params);
  if (rc != Cronet_RESULT_SUCCESS) {
    __android_log_print(ANDROID_LOG_ERROR, TAG,
                        "Cronet_UrlRequest_InitWithParams failed: rc=%d", (int)rc);
    Cronet_UrlRequestCallback_SetClientContext(ctx->callback, nullptr);
    cleanup(ctx);
    resultPromise->reject(std::make_exception_ptr(std::runtime_error("Cronet init failed")));
    return resultPromise;
  }
  Cronet_RESULT rcStart = Cronet_UrlRequest_Start(ctx->request);
  __android_log_print(ANDROID_LOG_INFO, TAG, "Cronet Start rc=%d", (int)rcStart);
  if (rcStart != Cronet_RESULT_SUCCESS) {
    __android_log_print(ANDROID_LOG_ERROR, TAG, "Cronet_UrlRequest_Start failed: rc=%d", (int)rcStart);
    Cronet_UrlRequestCallback_SetClientContext(ctx->callback, nullptr);
    cleanup(ctx);
    resultPromise->reject(std::make_exception_ptr(std::runtime_error("Cronet start failed")));
    return resultPromise;
  }

  return resultPromise;
#endif
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

    extern "C" JNIEXPORT jboolean JNICALL
    Java_com_margelo_nitro_nitrofetch_CronetBootstrap_nativeInitAfterJavaBootstrap(
            JNIEnv*, jclass, jstring jStoragePath) {
#if !NITROFETCH_HAS_CRONET
        return JNI_FALSE;
#else
        try {
            if (g_engineHolder && g_engineHolder->engine) {
                // already started
                return JNI_TRUE;
            }
            const char* storage = nullptr;
            if (jStoragePath) {
                JNIEnv* env = facebook::jni::Environment::current();
                storage = env->GetStringUTFChars(jStoragePath, nullptr);
            }

            Cronet_EnginePtr e = Cronet_Engine_Create();
            Cronet_EngineParamsPtr p = Cronet_EngineParams_Create();

            // Minimal sane params
            Cronet_EngineParams_enable_quic_set(p, true);
            Cronet_EngineParams_enable_http2_set(p, true);
            if (storage && *storage) {
                Cronet_EngineParams_storage_path_set(p, storage);
                // Optional: enable disk cache if your headers expose it
                // Cronet_EngineParams_http_cache_mode_set(p, CRONET_HTTP_CACHE_DISK);
                // Cronet_EngineParams_http_cache_max_size_set(p, 50 * 1024 * 1024);
            }

            Cronet_RESULT rc = Cronet_Engine_StartWithParams(e, p);
            Cronet_EngineParams_Destroy(p);

            if (jStoragePath) {
                JNIEnv* env = facebook::jni::Environment::current();
                env->ReleaseStringUTFChars(jStoragePath, storage);
            }

            if (rc != Cronet_RESULT_SUCCESS) {
                __android_log_print(ANDROID_LOG_ERROR, TAG, "Cronet_Engine_StartWithParams rc=%d", (int)rc);
                Cronet_Engine_Destroy(e);
                return JNI_FALSE;
            }

            g_engineHolder = std::make_shared<CronetEngineHolder>(e);
            g_engineHolder->ownsEngine = true;

            const char* ver = Cronet_Engine_GetVersionString(e);
            __android_log_print(ANDROID_LOG_INFO, TAG, "C-API engine started. native version=%s", ver ? ver : "");
            return JNI_TRUE;
        } catch (...) {
            g_engineHolder.reset();
            return JNI_FALSE;
        }
#endif
    }

} // namespace margelo::nitro::nitrofetch
