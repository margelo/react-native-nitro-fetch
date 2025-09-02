Cronet C API integration (Android)

High-level steps

- Bring Cronet binaries: add Cronet AAR or native libs/headers to your project. Options:
  - Use Google Maven `org.chromium.net:cronet-embedded` (Java wrapper) and extract libcronet. Or
  - Use Cronet standalone `.so` and C headers from Chromium release artifacts.
- Update `android/CMakeLists.txt` to link `cronet.aar` or `libcronet.**.so` and include headers.
- Initialize engine once per process from C++ and keep a pointer globally.
- Implement a thin C++ wrapper that:
  - Creates `Cronet_UrlRequestParams` from our `NitroRequest`.
  - Sets callbacks for redirect, headers received, read completed, finished, error.
  - Accumulates bytes to memory (MVP) or streams chunks via Nitro events (v2).
  - Resolves a `NitroResponse` with status, headers, final URL, and base64 body.
- Expose a JNI function callable from Kotlin via the Nitro spec.

CMake (sketch)

```
# After you obtain cronet headers + libs
add_library(cronet SHARED IMPORTED)
set_target_properties(cronet PROPERTIES IMPORTED_LOCATION
  ${CMAKE_SOURCE_DIR}/path/to/libcronet.112.0.0.0.so)
target_include_directories(${PACKAGE_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/path/to/cronet/include)
target_link_libraries(${PACKAGE_NAME} cronet)
```

Engine init (C++)

```
// cronet_bridge.hpp
#include <cronet_c.h>

bool cronet_init();
void cronet_shutdown();
bool cronet_request(const NitroRequest&, NitroResponse* out);

// cronet_bridge.cpp
static Cronet_EnginePtr g_engine = nullptr;
bool cronet_init() {
  if (g_engine) return true;
  Cronet_EngineParamsPtr params = Cronet_EngineParams_Create();
  Cronet_EngineParams_enable_quic_set(params, true);
  Cronet_EngineParams_user_agent_set(params, Cronet_String_Create("NitroFetch/0.1"));
  g_engine = Cronet_Engine_Create();
  auto rc = Cronet_Engine_StartWithParams(g_engine, params);
  Cronet_EngineParams_Destroy(params);
  return rc == CRONET_RESULT_SUCCESS;
}
```

Request (C++)

```
// Convert NitroRequest -> Cronet_UrlRequestParams
// Create Cronet_UrlRequest with callbacks
// In on_BytesRead, append to std::vector<uint8_t>
// In on_Success/on_Failed, fill NitroResponse fields and return
```

Kotlin hook

- Implement `override suspend fun request(req: NitroRequest): NitroResponse` in `NitroFetch.kt`.
- Call into JNI function that wraps `cronet_request` and returns a struct matching the generated Nitro type.

Notes

- For large bodies, prefer streaming in v2 (expose a request handle and chunk callbacks over Nitro).
- Enable HTTP/2 and QUIC in engine params if needed.
- Handle redirects, timeouts, and cancellation by keeping a map of active requests and calling `Cronet_UrlRequest_Cancel`.

