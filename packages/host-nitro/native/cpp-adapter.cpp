#include <jni.h>
#include "{{moduleName}}OnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::{{namespace}}::initialize(vm);
}
