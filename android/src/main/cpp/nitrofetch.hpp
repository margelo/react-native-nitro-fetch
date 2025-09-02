// nitrofetch.hpp
// Public C++ API for NitroFetch cpp-only autolinking.

#pragma once

#include <memory>

#include "../../../../nitrogen/generated/shared/c++/HybridNitroFetchSpec.hpp"
#include "../../../../nitrogen/generated/shared/c++/HybridNitroFetchClientSpec.hpp"
#include "../../../../nitrogen/generated/shared/c++/HybridNitroEnvSpec.hpp"
#include "../../../../nitrogen/generated/shared/c++/NitroRequest.hpp"
#include "../../../../nitrogen/generated/shared/c++/NitroResponse.hpp"

namespace margelo::nitro::nitrofetch {

// Forward declare Cronet engine holder; implemented in .cpp
struct CronetEngineHolder;

class CppNitroFetchClient : public HybridNitroFetchClientSpec {
 public:
  CppNitroFetchClient();
  explicit CppNitroFetchClient(std::shared_ptr<CronetEngineHolder> holder);

  std::shared_ptr<Promise<NitroResponse>> request(const NitroRequest& req) override;

 private:
  std::shared_ptr<CronetEngineHolder> _holder;
};

class CppNitroFetch : public HybridNitroFetchSpec {
 public:
  CppNitroFetch();

  std::shared_ptr<HybridNitroFetchClientSpec> createClient(const std::optional<std::shared_ptr<HybridNitroEnvSpec>>& env) override;
};

} // namespace margelo::nitro::nitrofetch

