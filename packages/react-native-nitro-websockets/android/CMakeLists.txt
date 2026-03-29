project(NitroFetchWebsockets)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitroFetchWebsockets)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# ── mbedTLS ──────────────────────────────────────────────────────────────────
set(ENABLE_TESTING             OFF CACHE BOOL "" FORCE)
set(ENABLE_PROGRAMS            OFF CACHE BOOL "" FORCE)
set(USE_SHARED_MBEDTLS_LIBRARY OFF CACHE BOOL "" FORCE)
set(USE_STATIC_MBEDTLS_LIBRARY ON  CACHE BOOL "" FORCE)
add_subdirectory(
  ${CMAKE_SOURCE_DIR}/../thirdparty/mbedtls
  ${CMAKE_BINARY_DIR}/mbedtls
)

# ── Pre-seed libwebsockets mbedTLS capability checks ─────────────────────────
# When mbedTLS is compiled in-tree via add_subdirectory, the .a files don't
# exist at cmake configure time, so libwebsockets' CHECK_FUNCTION_EXISTS link
# tests all fail. We know which APIs are present in mbedTLS 3.6.5 and pre-seed
# the cache so the checks are skipped.
foreach(_sym
    mbedtls_md_setup mbedtls_net_init mbedtls_rsa_complete
    mbedtls_ssl_conf_alpn_protocols mbedtls_ssl_get_alpn_protocol
    mbedtls_ssl_conf_sni mbedtls_ssl_set_hs_ca_chain
    mbedtls_ssl_set_hs_own_cert mbedtls_ssl_set_hs_authmode
    mbedtls_ssl_set_verify mbedtls_x509_crt_parse_file)
  set(LWS_HAVE_${_sym} 1 CACHE BOOL "" FORCE)
endforeach()
# mbedtls_internal_aes_encrypt was removed in mbedTLS 3.x; leave it as 0.
set(LWS_HAVE_mbedtls_internal_aes_encrypt 0 CACHE BOOL "" FORCE)

# ── libwebsockets ─────────────────────────────────────────────────────────────
set(LWS_WITH_MBEDTLS          ON  CACHE BOOL "" FORCE)
set(LWS_WITH_SSL              ON  CACHE BOOL "" FORCE)
set(LWS_WITH_SHARED           OFF CACHE BOOL "" FORCE)
set(LWS_WITH_STATIC           ON  CACHE BOOL "" FORCE)
set(LWS_WITHOUT_SERVER        ON  CACHE BOOL "" FORCE)
set(LWS_WITHOUT_TESTAPPS      ON  CACHE BOOL "" FORCE)
set(LWS_WITHOUT_TEST_SERVER   ON  CACHE BOOL "" FORCE)
set(LWS_WITHOUT_DAEMONIZE     ON  CACHE BOOL "" FORCE)
set(LWS_WITH_LIBUV            OFF CACHE BOOL "" FORCE)
set(LWS_WITH_ZLIB             OFF CACHE BOOL "" FORCE)
set(LWS_WITH_HTTP2            OFF CACHE BOOL "" FORCE)
set(LWS_WITH_SECURE_STREAMS   OFF CACHE BOOL "" FORCE)
set(MBEDTLS_INCLUDE_DIRS      "${CMAKE_SOURCE_DIR}/../thirdparty/mbedtls/include" CACHE PATH "" FORCE)
set(MBEDTLS_LIBRARIES         mbedtls mbedx509 mbedcrypto CACHE STRING "" FORCE)
set(LWS_WITH_EXPORT_LWSTARGETS OFF CACHE BOOL "" FORCE)
set(CMAKE_POLICY_DEFAULT_CMP0052 OLD)
add_subdirectory(
  ${CMAKE_SOURCE_DIR}/../thirdparty/libwebsockets
  ${CMAKE_BINARY_DIR}/libwebsockets
)

# ── Embed Mozilla CA bundle for TLS verification ──────────────────────────────
# Generate a C++ source file that embeds cacert.pem as an in-memory byte array.
# This is used by LwsContext via lws_context_creation_info.client_ssl_ca_mem.
file(READ "${CMAKE_SOURCE_DIR}/src/main/cpp/cacert.pem" CACERT_PEM_CONTENT)
file(WRITE "${CMAKE_BINARY_DIR}/cacert_pem.cpp"
"namespace margelo::nitro::nitrofetchwebsockets {
extern const char kCacertPemData[] = R\"CACERT(${CACERT_PEM_CONTENT})CACERT\";
extern const unsigned int kCacertPemLen = sizeof(kCacertPemData) - 1;
}
")

# ── Our library ───────────────────────────────────────────────────────────────
add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
  src/main/cpp/LwsContext.cpp
  src/main/cpp/WebSocketConnection.cpp
  ../cpp/HybridWebSocket.cpp
  ../cpp/WebSocketPrewarmer.cpp
  ${CMAKE_BINARY_DIR}/cacert_pem.cpp
)

# Add Nitrogen specs
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroFetchWebsockets+autolinking.cmake)

# Include directories
include_directories(
  "src/main/cpp"
  "../cpp"
  "src/main/cpp"
  "${CMAKE_SOURCE_DIR}/../nitrogen/generated/shared/c++"
  "${CMAKE_SOURCE_DIR}/../thirdparty/libwebsockets/include"
  "${CMAKE_BINARY_DIR}/libwebsockets"   # generated lws_config.h
  "${CMAKE_SOURCE_DIR}/../thirdparty/mbedtls/include"
)

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
  websockets
  mbedtls
  mbedx509
  mbedcrypto
)
