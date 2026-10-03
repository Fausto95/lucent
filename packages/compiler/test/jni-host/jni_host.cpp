// The desktop JNI host: Lucent's Android glue run on a JVM this process
// starts, with no Android OS. android.cpp's JNI is built with
// LUCENT_JNI_HOST; what it leaves to Android (the thread's JNIEnv through
// fbjni, the app's Context, the API level) is defined here, and the main
// thread is the host runtime's.
#include "jni_host.h"

#include <lucent/platform/android.h>

#include <cstdio>
#include <cstdlib>
#include <string>

namespace {

JavaVM* vm = nullptr;

}  // namespace

void lucentStartJvm(const char* classpath) {
  std::string option = std::string("-Djava.class.path=") + classpath;
  JavaVMOption options[] = {{const_cast<char*>(option.c_str()), nullptr}, {const_cast<char*>("-Xcheck:jni"), nullptr}};
  JavaVMInitArgs args{JNI_VERSION_10, 2, options, JNI_FALSE};
  JNIEnv* env = nullptr;

  if (JNI_CreateJavaVM(&vm, reinterpret_cast<void**>(&env), &args) != JNI_OK) {
    std::fprintf(stderr, "the JVM did not start\n");
    std::exit(3);
  }
}

namespace lucent::jni {

// A thread the JVM did not start is attached on its first call, as fbjni does,
// as a daemon: the JVM need not wait for it at exit.
JNIEnv* env() {
  JNIEnv* e = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&e), JNI_VERSION_10) == JNI_OK) return e;

  vm->AttachCurrentThreadAsDaemon(reinterpret_cast<void**>(&e), nullptr);
  return e;
}

NativeRef appContext() {
  throw Exception(makeError(String::fromLatin1("TypeError"), String::fromLatin1("no Android app: the desktop JNI host has no Context")));
}

bool available(double) { return true; }

}  // namespace lucent::jni
