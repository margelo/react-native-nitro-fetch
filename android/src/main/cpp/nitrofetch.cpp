// C++ core for NitroFetch – Cronet-driven implementation scaffolding.
// Implements classes declared in nitrofetch.hpp

#include <jni.h>
#include <string>
#include <memory>
#include <stdexcept>

#include "nitrofetch.hpp"

#if __has_include(<cronet_c.h>)
  #include <cronet_c.h>
  #define HAVE_CRONET_HEADER 1
#elif __has_include(<cronet/cronet_c.h>)
  #include <cronet/cronet_c.h>
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
  std::string cacheDir;

  explicit CronetEngineHolder(std::string cache) : cacheDir(std::move(cache)) {
    Cronet_EngineParamsPtr params = Cronet_EngineParams_Create();
    Cronet_EngineParams_enable_quic_set(params, true);
    // Setup storage path for HTTP cache
    if (!cacheDir.empty()) {
      Cronet_EngineParams_storage_path_set(params, Cronet_String_Create(cacheDir.c_str()));
      Cronet_EngineParams_http_cache_mode_set(params, CRONET_HTTP_CACHE_DISABLED /* adjust later */);
    }
    Cronet_EngineParams_user_agent_set(params, Cronet_String_Create("NitroFetch/0.1"));
    engine = Cronet_Engine_Create();
    auto rc = Cronet_Engine_StartWithParams(engine, params);
    Cronet_EngineParams_Destroy(params);
    if (rc != CRONET_RESULT_SUCCESS) {
      Cronet_Engine_Destroy(engine);
      engine = nullptr;
      throw std::runtime_error("Cronet engine start failed");
    }
  }

  ~CronetEngineHolder() {
    if (engine) {
      Cronet_Engine_Shutdown(engine);
      Cronet_Engine_Destroy(engine);
      engine = nullptr;
    }
  }
};
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
  auto holder = std::make_shared<CronetEngineHolder>(cacheDir);
  return std::make_shared<CppNitroFetchClient>(holder);
#else
  return std::make_shared<CppNitroFetchClient>();
#endif
}

} // namespace margelo::nitro::nitrofetch
