project(nitrofetch)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME nitrofetch)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Define C++ library and add all sources
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/nitrofetch+autolinking.cmake)

# Set up local includes
include_directories("src/main/cpp" "../cpp")

# Allow Gradle to pass a CRONET_ROOT pointing to extracted headers/libs (see build.gradle prepareCronet task)
if (DEFINED CRONET_ROOT)
    set(CRONET_ROOT_DIR ${CRONET_ROOT})
else()
    set(CRONET_ROOT_DIR ${CMAKE_SOURCE_DIR}/cronet)
endif()

# Optional: include Cronet headers if present (placed by script under android/cronet/include)
if (EXISTS ${CRONET_ROOT_DIR}/include)
    message(STATUS "Cronet headers base: ${CRONET_ROOT_DIR}/include")
    include_directories(${CRONET_ROOT_DIR}/include)
    # Some Cronet packages nest headers under include/cronet
    if (EXISTS ${CRONET_ROOT_DIR}/include/cronet)
        include_directories(${CRONET_ROOT_DIR}/include/cronet)
        if (EXISTS ${CRONET_ROOT_DIR}/include/cronet/cronet_c.h)
            message(STATUS "Found cronet_c.h: ${CRONET_ROOT_DIR}/include/cronet/cronet_c.h")
        else()
            message(WARNING "cronet_c.h not found under ${CRONET_ROOT_DIR}/include/cronet")
        endif()
        if (EXISTS ${CRONET_ROOT_DIR}/include/cronet/cronet.idl_c.h)
            message(STATUS "Found cronet.idl_c.h: ${CRONET_ROOT_DIR}/include/cronet/cronet.idl_c.h")
        else()
            message(WARNING "cronet.idl_c.h not found under ${CRONET_ROOT_DIR}/include/cronet")
        endif()
    else()
        message(WARNING "Cronet nested include dir not found: ${CRONET_ROOT_DIR}/include/cronet")
    endif()
endif()

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android # <-- Android core
)

## Kotlin-based implementation only; no custom C++ headers forced.

# Optional: link Cronet if library file is present (drop-in via prepare script or Gradle task)
set(CRONET_LIB_DIR ${CRONET_ROOT_DIR}/libs/${ANDROID_ABI})
if (EXISTS ${CRONET_LIB_DIR})
    file(GLOB CRONET_LIBS "${CRONET_LIB_DIR}/*cronet*.so")
    if (CRONET_LIBS)
        message(STATUS "Linking Cronet from ${CRONET_LIB_DIR}")
        target_link_libraries(${PACKAGE_NAME} ${CRONET_LIBS})
        target_compile_definitions(${PACKAGE_NAME} PRIVATE NITROFETCH_LINKS_CRONET=1)
    else()
        message(WARNING "Cronet libs not found in ${CRONET_LIB_DIR}")
    endif()
endif()
