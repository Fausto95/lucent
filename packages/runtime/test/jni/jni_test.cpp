// The runtime's JNI glue (platform/android.cpp, built with LUCENT_JNI_HOST)
// on a desktop JVM: what crosses from Java into Lucent code, and what it
// leaves in the JVM. Built and run by run.sh in this directory; the JVM
// runs with -Xcheck:jni, whose warnings fail the run.
#include <jni.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "jni_host.h"
#include "lucent/lucent.h"
#include "lucent/platform/android.h"

using namespace lucent;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                                 \
  do {                                                                              \
    checks++;                                                                       \
    if (!(cond)) {                                                                  \
      failures++;                                                                   \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                               \
  } while (0)

/// What a Java exception pending on `env` says, cleared; empty if none.
static std::string takePending(JNIEnv* env) {
  if (!env->ExceptionCheck()) return "";

  jthrowable t = env->ExceptionOccurred();
  env->ExceptionClear();
  jclass cls = env->GetObjectClass(t);
  jmethodID getName = env->GetMethodID(env->FindClass("java/lang/Class"), "getName", "()Ljava/lang/String;");
  auto name = static_cast<jstring>(env->CallObjectMethod(cls, getName));
  const char* chars = env->GetStringUTFChars(name, nullptr);
  std::string out(chars);
  env->ReleaseStringUTFChars(name, chars);
  env->DeleteLocalRef(name);
  env->DeleteLocalRef(cls);
  env->DeleteLocalRef(t);
  return out;
}

/// A Java interface method Lucent code implements, returning a primitive:
/// when the Lucent side throws, Java's caller gets the type's zero value
/// (the error is reported), not a NullPointerException hiding it.
static void primitiveResultsOfAThrowingProxy() {
  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  static int identity;

  jobject supplier = jni::proxyFor(env, "java/util/function/IntSupplier", &identity,
                                   {{"getAsInt()", [](JNIEnv*, jobjectArray) -> jobject { throwTypeError("the Lucent side failed"); }}});
  CHECK(supplier != nullptr);

  jmethodID getAsInt = env->GetMethodID(env->FindClass("java/util/function/IntSupplier"), "getAsInt", "()I");
  jint got = env->CallIntMethod(supplier, getAsInt);

  CHECK(takePending(env).empty());
  CHECK(got == 0);

  static int working;
  jobject answers = jni::proxyFor(env, "java/util/function/IntSupplier", &working,
                                  {{"getAsInt()", [](JNIEnv* e, jobjectArray) -> jobject { return jni::boxInt(e, 42); }}});
  CHECK(env->CallIntMethod(answers, getAsInt) == 42);
  CHECK(takePending(env).empty());
}

/// How many local references were made between `before` and now on this
/// thread: HotSpot hands out a frame's references from consecutive slots.
static long madeSince(JNIEnv* env, jobject before) {
  jobject now = env->NewLocalRef(before);
  long n = (reinterpret_cast<char*>(now) - reinterpret_cast<char*>(before)) / static_cast<long>(sizeof(void*)) - 1;
  env->DeleteLocalRef(now);
  return n;
}

/// Reading a Java exception as a Lucent error (errorOf, rethrowPending)
/// leaves no local reference behind: on a thread Lucent attached nothing
/// frees them (Android aborts past 512), and in a native method they pile
/// up until it returns.
static void errorsLeaveNoLocalReferences() {
  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  jclass cls = env->FindClass("java/lang/IllegalStateException");
  jobject mark = env->NewLocalRef(cls);
  int read = 0;

  for (int i = 0; i < 16; i++) {
    env->ThrowNew(cls, "boom");
    try {
      jni::rethrowPending(env);
    } catch (const Exception& error) {
      if (error.error()->code.has() && error.error()->code.get().toUtf8() == "java.lang.IllegalStateException") read++;
    }
  }

  CHECK(read == 16);
  // The thrown exception itself, each time (ExceptionOccurred's).
  long made = madeSince(env, mark);
  CHECK(made <= 16);
  if (made > 16) std::fprintf(stderr, "jni: 16 errors read left %ld local references\n", made);
}

int main(int, char** argv) {
  lucentStartJvm(argv[1]);

  std::atomic<bool> done{false};
  postCallback([&] {
    primitiveResultsOfAThrowingProxy();
    errorsLeaveNoLocalReferences();
    done = true;
  });

  for (int i = 0; i < 20000 && !done; i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  CHECK(done);

  std::printf("jni: %d checks, %d failures\n", checks, failures);
  std::fflush(stdout);
  return failures == 0 ? 0 : 1;
}
