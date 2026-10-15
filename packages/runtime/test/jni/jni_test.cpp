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
#include "lucent/view.h"

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

/// The Java buffer whose bytes a NativeBuffer adopted (adoptByteBuffer)
/// stays reachable until the bytes are released, once: at close(), or
/// when the ArrayBuffer they moved to goes.
static void adoptedByteBuffersAreHeldUntilReleased() {
  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  jclass byteBuffer = env->FindClass("java/nio/ByteBuffer");
  jmethodID allocateDirect = env->GetStaticMethodID(byteBuffer, "allocateDirect", "(I)Ljava/nio/ByteBuffer;");
  jmethodID get = env->GetMethodID(byteBuffer, "get", "(I)B");
  jclass system = env->FindClass("java/lang/System");
  jmethodID gc = env->GetStaticMethodID(system, "gc", "()V");

  // Whether the object `weak` names is collected, after a few collections.
  auto collected = [&](jweak weak) {
    for (int i = 0; i < 50 && !env->IsSameObject(weak, nullptr); i++) {
      env->CallStaticVoidMethod(system, gc);
      CHECK(takePending(env).empty());
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return env->IsSameObject(weak, nullptr) == JNI_TRUE;
  };
  // A direct buffer of `size` bytes, adopted, with `weak` naming the Java buffer.
  auto adopted = [&](jint size, jweak& weak) {
    jni::LocalFrame inner(env);
    jobject direct = env->CallStaticObjectMethod(byteBuffer, allocateDirect, size);
    CHECK(takePending(env).empty());
    weak = env->NewWeakGlobalRef(direct);
    return jni::adoptByteBuffer(jni::wrap(env, direct, "ByteBuffer"));
  };

  jweak closedWeak = nullptr;
  {
    NativeBuffer closed = adopted(8, closedWeak);
    CHECK(closed->size() == 8);
    closed->withWrite([](std::span<uint8_t> bytes) { bytes[1] = 7; });
    jobject java = env->NewLocalRef(closedWeak);
    jbyte second = env->CallByteMethod(java, get, 1);
    CHECK(takePending(env).empty());
    CHECK(second == 7);
    env->DeleteLocalRef(java);
    CHECK(!collected(closedWeak));
    CHECK(closed->close());
    CHECK(collected(closedWeak));
  }
  env->DeleteWeakGlobalRef(closedWeak);

  jweak movedWeak = nullptr;
  {
    ArrayBuffer moved = adopted(4, movedWeak)->transferToArrayBuffer();
    CHECK(moved.size() == 4);
    CHECK(!collected(movedWeak));
  }
  CHECK(collected(movedWeak));
  env->DeleteWeakGlobalRef(movedWeak);
}

/// Runs `f` as a turn of the main context, where mounts run.
template <class F>
static void onUi(F f) {
  std::atomic<bool> ran{false};

  ExecutionContext::main().post([&] {
    f();
    ran = true;
  });

  for (int i = 0; i < 20000 && !ran; i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  CHECK(ran);
}

/// The context a mount's views are made with (T125): its hosting view's
/// while its host calls it (HostViewEntry: setup, an update, a command);
/// else, in its content, as a callback its setup made runs, its root
/// view's, so a view a later commit makes is themed as setup's were. None
/// outside any mount, or for a root that is not a view.
static void viewsTakeTheirMountsContext() {
  onUi([] {
    JNIEnv* env = jni::env();
    jni::LocalFrame frame(env);
    jclass contextClass = env->FindClass("android/content/Context");
    jclass viewClass = env->FindClass("android/view/View");
    jmethodID newContext = env->GetMethodID(contextClass, "<init>", "()V");
    jmethodID newView = env->GetMethodID(viewClass, "<init>", "(Landroid/content/Context;)V");
    jobject shellContext = env->NewObject(contextClass, newContext);
    jobject rootContext = env->NewObject(contextClass, newContext);
    jobject shell = env->NewObject(viewClass, newView, shellContext);
    NativeRef root = jni::wrap(env, env->NewObject(viewClass, newView, rootContext), "a view");
    auto is = [&](const Opt<NativeRef>& context, jobject expected) {
      return context.has() && env->IsSameObject(jni::unwrap(context), expected);
    };

    CHECK(!jni::hostContext().has());
    {
      jni::HostViewEntry hosting(shell);
      CHECK(is(jni::hostContext(), shellContext));
    }

    auto content = ui::Content::create([] {});
    {
      ui::ContentEntry entry(content);
      // Before its setup returned, the mount has no root.
      CHECK(!jni::hostContext().has());
      ui::ownContent(nullptr, root);
      CHECK(is(jni::hostContext(), rootContext));
      {
        // Its host's view first.
        jni::HostViewEntry hosting(shell);
        CHECK(is(jni::hostContext(), shellContext));
      }
      CHECK(is(jni::hostContext(), rootContext));
    }
    CHECK(!jni::hostContext().has());

    // A Fragment's mount: its views come from the Fragment, not from here.
    auto fragment = ui::Content::create([] {});
    {
      ui::ContentEntry entry(fragment);
      ui::ownContent(nullptr, jni::wrap(env, env->NewObject(contextClass, newContext), "an object"));
      CHECK(!jni::hostContext().has());
    }
    CHECK(takePending(env).empty());
  });
}

int main(int, char** argv) {
  lucentStartJvm(argv[1]);

  std::atomic<bool> done{false};
  postCallback([&] {
    primitiveResultsOfAThrowingProxy();
    errorsLeaveNoLocalReferences();
    adoptedByteBuffersAreHeldUntilReleased();
    done = true;
  });

  for (int i = 0; i < 20000 && !done; i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  CHECK(done);
  viewsTakeTheirMountsContext();

  std::printf("jni: %d checks, %d failures\n", checks, failures);
  std::fflush(stdout);
  return failures == 0 ? 0 : 1;
}
