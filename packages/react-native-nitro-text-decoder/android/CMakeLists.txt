project(NitroTextDecoder)
cmake_minimum_required(VERSION 3.9.0)

set (PACKAGE_NAME NitroTextDecoder)
set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 20)

# Define C++ library and add all sources
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        ../cpp/HybridTextEncoding.cpp
        ../cpp/HybridTextDecoder.cpp
        ../cpp/TextDecoderUtils.cpp
        ../cpp/simdutf.cpp
)

# Drop simdutf's base64 support — the decoder only uses UTF transcoding
# (~20-30 KB saved on stripped binary).
target_compile_definitions(${PACKAGE_NAME} PRIVATE
        SIMDUTF_FEATURE_BASE64=0
)

# simdutf is tuned for -O3; ThinLTO lets the JSI binding inline into
# the simdutf entry points. NDK Release defaults to -O2, which leaves
# perf on the table.
target_compile_options(${PACKAGE_NAME} PRIVATE -O3 -flto=thin)
target_link_options(${PACKAGE_NAME} PRIVATE -flto=thin)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroTextDecoder+autolinking.cmake)

# Set up local includes
include_directories(
        "src/main/cpp"
        "../cpp"
)

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android                                   # <-- Android core
)
