#include <jni.h>
#include "nitrofetchOnLoad.hpp"
#include <fbjni/fbjni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitrofetch::registerAllNatives();
  });
}