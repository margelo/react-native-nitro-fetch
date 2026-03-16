#include <jni.h>
#include "nitrofetchOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::nitrofetch::initialize(vm);
}
