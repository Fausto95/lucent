#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroBenchNitroOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::benchnitro::registerAllNatives();
  });
}
