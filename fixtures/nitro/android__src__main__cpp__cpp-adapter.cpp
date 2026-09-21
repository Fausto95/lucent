#include <jni.h>
#include "NitroLucentOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::lucent::initialize(vm);
}
