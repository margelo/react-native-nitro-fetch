#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroTextDecoderOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitrotextdecoder::registerAllNatives();
  });
}
