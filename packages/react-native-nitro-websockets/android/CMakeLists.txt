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
# Tell libwebsockets where to find mbedTLS headers and libs
set(MBEDTLS_INCLUDE_DIRS
  "${CMAKE_SOURCE_DIR}/../thirdparty/mbedtls/include"
  CACHE PATH "" FORCE)
set(MBEDTLS_LIBRARIES
  mbedtls mbedx509 mbedcrypto
  CACHE STRING "" FORCE)
# Disable export target installation (mbedtls targets aren't in any export set)
set(LWS_WITH_EXPORT_LWSTARGETS OFF CACHE BOOL "" FORCE)
# Allow source-tree paths in INTERFACE_INCLUDE_DIRECTORIES (CMP0052 old behavior)
set(CMAKE_POLICY_DEFAULT_CMP0052 OLD)
add_subdirectory(
  ${CMAKE_SOURCE_DIR}/../thirdparty/libwebsockets
  ${CMAKE_BINARY_DIR}/libwebsockets
)

# ── Embed Mozilla CA bundle for TLS verification ──────────────────────────────
# Generate a C++ source file that embeds cacert.pem as an in-memory byte array.
# This is used by LwsContext via lws_context_creation_info.client_ssl_ca_mem.
file(READ "${CMAKE_SOURCE_DIR}/../cpp/cacert.pem" CACERT_PEM_CONTENT)
file(WRITE "${CMAKE_BINARY_DIR}/cacert_pem.cpp"
"namespace margelo::nitro::nitrofetchwebsockets {
extern const char kCacertPemData[] = R\"CACERT(${CACERT_PEM_CONTENT})CACERT\";
extern const unsigned int kCacertPemLen = sizeof(kCacertPemData) - 1;
}
")

# ── Our library ───────────────────────────────────────────────────────────────
add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
  ../cpp/LwsContext.cpp
  ../cpp/WebSocketConnection.cpp
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
