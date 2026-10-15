// Lucent runtime — Android: JNI environment, classes, errors, the main
// Looper. Built into Android apps (fbjni comes with React Native); its JNI
// alone also into the desktop JNI host the tests run on a JVM
// (LUCENT_JNI_HOST), which defines env(), appContext() and available().
#if defined(__ANDROID__) || defined(LUCENT_JNI_HOST)

#include "android.h"
#include "../entries.h"

#ifdef __ANDROID__
#include <dlfcn.h>
#include <fbjni/NativeRunnable.h>
#include <fbjni/fbjni.h>
#include <sys/system_properties.h>
#endif

#include <atomic>
#include <cstring>
#include <deque>
#include <thread>
#include <cstdint>
#include <cstdlib>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace lucent::jni {

#ifdef __ANDROID__
JNIEnv* env() { return facebook::jni::Environment::ensureCurrentThreadIsAttached(); }
#endif

namespace {

[[noreturn]] void failWith(const char* name, const std::string& message) {
  throw Exception(makeError(String::fromLatin1(name), String::fromUtf8(message)));
}

jclass findClassWithAppLoader(JNIEnv* e, const char* name) {
  // Threads the app did not start see only the system class loader; the
  // Application's loader sees AndroidX, Play services and the app's own classes.
  jobject app = unwrap(appContext());
  jclass contextCls = e->FindClass("android/content/Context");
  jmethodID getLoader = e->GetMethodID(contextCls, "getClassLoader", "()Ljava/lang/ClassLoader;");
  jobject loader = e->CallObjectMethod(app, getLoader);
  jclass loaderCls = e->FindClass("java/lang/ClassLoader");
  jmethodID loadClass = e->GetMethodID(loaderCls, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
  std::string dotted(name);
  for (char& c : dotted) {
    if (c == '/') c = '.';
  }
  jstring jname = e->NewStringUTF(dotted.c_str());
  auto cls = static_cast<jclass>(e->CallObjectMethod(loader, loadClass, jname));
  check(e);
  return cls;
}

bool sameObject(void* a, void* b) { return env()->IsSameObject(static_cast<jobject>(a), static_cast<jobject>(b)); }

void releaseGlobal(void* ref) { env()->DeleteGlobalRef(static_cast<jobject>(ref)); }

namespace {

// How WeakRef, WeakMap and WeakSet refer to an object (lucent/weak.h): a weak
// global reference, which the garbage collector clears as it collects the object.
void* makeWeak(void* strong) { return env()->NewWeakGlobalRef(static_cast<jobject>(strong)); }

void dropWeak(void* weak) { env()->DeleteWeakGlobalRef(static_cast<jweak>(weak)); }

NativeRef lockWeak(void* weak) {
  JNIEnv* e = env();
  jobject local = e->NewLocalRef(static_cast<jweak>(weak));
  if (!local) return NativeRef();
  return wrap(e, local, "");
}

/// System.identityHashCode: equal for refs to one object.
std::size_t hashObject(void* strong) {
  JNIEnv* e = env();
  static jclass system = findClass("java/lang/System");
  static jmethodID identity = staticMethod(system, "identityHashCode", "(Ljava/lang/Object;)I");
  jint hash = e->CallStaticIntMethod(system, identity, static_cast<jobject>(strong));
  check(e);
  return static_cast<std::size_t>(static_cast<uint32_t>(hash));
}

constexpr NativeWeakOps weakOps{makeWeak, lockWeak, dropWeak, hashObject};

}  // namespace

}  // namespace

jclass findClass(const char* name) {
  static std::mutex m;
  static auto* classes = new std::unordered_map<std::string, jclass>();
  {
    std::lock_guard<std::mutex> g(m);
    auto it = classes->find(name);
    if (it != classes->end()) return it->second;
  }
  JNIEnv* e = env();
  jclass local = e->FindClass(name);
  if (!local) {
    e->ExceptionClear();
    local = findClassWithAppLoader(e, name);
  }
  if (!local) failWith("TypeError", std::string("Java class not found: ") + name);
  auto global = static_cast<jclass>(e->NewGlobalRef(local));
  e->DeleteLocalRef(local);
  std::lock_guard<std::mutex> g(m);
  classes->emplace(name, global);
  return global;
}

#define LUCENT_JNI_ID(fn, kind)                                                              \
  JNIEnv* e = env();                                                                         \
  auto id = e->fn(cls, name, sig);                                                           \
  if (!id) {                                                                                 \
    e->ExceptionClear();                                                                     \
    failWith("TypeError", std::string("Java " kind " not found: ") + name + " " + sig);      \
  }                                                                                          \
  return id;

jmethodID method(jclass cls, const char* name, const char* sig) { LUCENT_JNI_ID(GetMethodID, "method") }
jmethodID staticMethod(jclass cls, const char* name, const char* sig) { LUCENT_JNI_ID(GetStaticMethodID, "method") }
jfieldID field(jclass cls, const char* name, const char* sig) { LUCENT_JNI_ID(GetFieldID, "field") }
jfieldID staticField(jclass cls, const char* name, const char* sig) { LUCENT_JNI_ID(GetStaticFieldID, "field") }

namespace {

/// Lucent errors thrown to Java, by the Java exception carrying each (a weak
/// reference): errorOf gives back the error itself, not a copy.
struct Thrown {
  jweak exception;
  Error error;
};

std::mutex thrownMutex;
std::vector<Thrown>& thrown() {
  static auto* v = new std::vector<Thrown>();
  return *v;
}

/// The Lucent error `t` carries, removed from the list when `take` (Lucent
/// has caught the exception); none for other exceptions.
std::optional<Error> findThrown(JNIEnv* e, jobject t, bool take) {
  std::lock_guard<std::mutex> g(thrownMutex);
  auto& v = thrown();
  for (auto it = v.begin(); it != v.end(); ++it) {
    if (!e->IsSameObject(it->exception, t)) continue;
    if (!take) return it->error;

    Error error = std::move(it->error);
    e->DeleteWeakGlobalRef(it->exception);
    v.erase(it);
    return error;
  }
  return std::nullopt;
}

}  // namespace

jthrowable throwableOf(JNIEnv* e, Error error) {
  static jclass cls = findClass("java/lang/RuntimeException");
  static jmethodID init = method(cls, "<init>", "(Ljava/lang/String;)V");
  jstring message = toJString(e, error->message);
  auto exception = static_cast<jthrowable>(e->NewObject(cls, init, message));
  e->DeleteLocalRef(message);
  if (!exception) return nullptr;  // A pending OutOfMemoryError ends the call instead.

  {
    std::lock_guard<std::mutex> g(thrownMutex);
    auto& v = thrown();
    // Exceptions Java dropped without Lucent reading them.
    std::erase_if(v, [e](Thrown& x) {
      if (!e->IsSameObject(x.exception, nullptr)) return false;
      e->DeleteWeakGlobalRef(x.exception);
      return true;
    });
    v.push_back({e->NewWeakGlobalRef(exception), std::move(error)});
  }
  return exception;
}

void throwToJava(JNIEnv* e, Error error) {
  jthrowable exception = throwableOf(e, std::move(error));
  if (!exception) return;

  e->Throw(exception);
  e->DeleteLocalRef(exception);
}

namespace {

/// A primitive of descriptor `d`, from its boxed object.
jvalue unboxed(JNIEnv* e, char d, jobject boxed) {
  jvalue v{};
  switch (d) {
    case 'Z': v.z = unboxBoolean(e, boxed) ? JNI_TRUE : JNI_FALSE; break;
    case 'J': v.j = unboxLong(e, boxed); break;
    case 'I': v.i = static_cast<jint>(unboxNumber(e, boxed)); break;
    case 'S': v.s = static_cast<jshort>(unboxNumber(e, boxed)); break;
    case 'B': v.b = static_cast<jbyte>(unboxNumber(e, boxed)); break;
    case 'C': v.c = static_cast<jchar>(unboxNumber(e, boxed)); break;
    case 'F': v.f = static_cast<jfloat>(unboxNumber(e, boxed)); break;
    case 'D': v.d = unboxNumber(e, boxed); break;
    default: v.l = boxed;
  }
  return v;
}

}  // namespace

jobject boxValueClass(JNIEnv* e, const char* cls, const char* underlying, jobject value) {
  if (!value && underlying[0] != 'L' && underlying[0] != '[') return nullptr;

  jclass c = findClass(cls);
  std::string sig = std::string("(") + underlying + ")L" + cls + ";";
  jmethodID box = staticMethod(c, "box-impl", sig.c_str());
  jvalue v = unboxed(e, underlying[0], value);
  jobject r = e->CallStaticObjectMethodA(c, box, &v);
  check(e);
  return r;
}

jobject unboxValueClass(JNIEnv* e, const char* cls, const char* underlying, jobject boxed) {
  if (!boxed) return nullptr;

  jmethodID unbox = method(findClass(cls), "unbox-impl", (std::string("()") + underlying).c_str());

  // Each read checked before the boxing calls Java again.
  auto read = [e](auto v) {
    check(e);
    return v;
  };
  switch (underlying[0]) {
    case 'Z': return boxBoolean(e, read(e->CallBooleanMethod(boxed, unbox)) == JNI_TRUE);
    case 'J': return boxLong(e, read(e->CallLongMethod(boxed, unbox)));
    case 'I': return boxInt(e, read(e->CallIntMethod(boxed, unbox)));
    case 'S': return boxShort(e, read(e->CallShortMethod(boxed, unbox)));
    case 'B': return boxByte(e, read(e->CallByteMethod(boxed, unbox)));
    case 'C': return boxChar(e, read(e->CallCharMethod(boxed, unbox)));
    case 'F': return boxFloat(e, read(e->CallFloatMethod(boxed, unbox)));
    case 'D': return boxDouble(e, read(e->CallDoubleMethod(boxed, unbox)));
    default: return read(e->CallObjectMethod(boxed, unbox));
  }
}

jobject suspendedCall(JNIEnv* e, jobject continuation, const std::function<void(Resume)>& start) {
  static jclass intrinsics = findClass("kotlin/coroutines/intrinsics/IntrinsicsKt");
  static jmethodID intercepted = staticMethod(
      intrinsics, "intercepted", "(Lkotlin/coroutines/Continuation;)Lkotlin/coroutines/Continuation;");
  static jclass safeClass = findClass("kotlin/coroutines/SafeContinuation");
  static jmethodID safeInit = method(safeClass, "<init>", "(Lkotlin/coroutines/Continuation;)V");
  static jmethodID getOrThrow = method(safeClass, "getOrThrow", "()Ljava/lang/Object;");
  static jmethodID resumeWith = method(safeClass, "resumeWith", "(Ljava/lang/Object;)V");
  static jclass results = findClass("kotlin/ResultKt");
  static jmethodID failure = staticMethod(results, "createFailure", "(Ljava/lang/Throwable;)Ljava/lang/Object;");

  // As suspendCoroutine does: resumed through its dispatcher, never on the Lucent thread,
  // and a result that arrives before the call returns is its result.
  jobject dispatched = e->CallStaticObjectMethod(intrinsics, intercepted, continuation);
  check(e);
  jobject local = e->NewObject(safeClass, safeInit, dispatched);
  e->DeleteLocalRef(dispatched);
  check(e);
  auto safe = std::make_shared<NativeRef>(wrap(e, e->NewLocalRef(local), "a continuation"));

  // Kotlin's Result is the value itself, or a failure of the Throwable.
  start([safe](JNIEnv* env, jobject value, const Error* error) {
    jobject result = value;
    if (error) {
      jthrowable t = throwableOf(env, *error);
      result = env->CallStaticObjectMethod(results, failure, t);
      env->DeleteLocalRef(t);
      check(env);
    }
    env->CallVoidMethod(unwrap(*safe), resumeWith, result);
    if (error) env->DeleteLocalRef(result);
    check(env);
  });

  // COROUTINE_SUSPENDED, or the result already there; a failure already there stays pending.
  jobject r = e->CallObjectMethod(local, getOrThrow);
  e->DeleteLocalRef(local);
  return r;
}

jobject unit(JNIEnv* e) {
  static jclass cls = findClass("kotlin/Unit");
  static jfieldID instance = staticField(cls, "INSTANCE", "Lkotlin/Unit;");
  return e->GetStaticObjectField(cls, instance);
}

void rethrowPending(JNIEnv* e) {
  jthrowable t = e->ExceptionOccurred();
  e->ExceptionClear();
  Error error = errorOf(e, t);
  e->DeleteLocalRef(t);
  throw Exception(std::move(error));
}

namespace {

/// A Java exception as a Lucent error; a Lucent error it carries is
/// removed from the list when `take`.
Error errorOf(JNIEnv* e, jobject t, bool take) {
  if (auto own = t ? findThrown(e, t, take) : std::nullopt) return std::move(*own);
  if (!t) {
    // No exception to read: a cancelled task.
    Error err = makeError(String::fromLatin1("Error"), String::fromLatin1("cancelled"));
    err->code = String::fromLatin1("java.util.concurrent.CancellationException");
    return err;
  }
  // Every reference made here is freed here: the caller may be a thread
  // Lucent attached, which never returns to Java to free them.
  LocalFrame frame(e);
  // The methods, found once (global class references). These calls throw
  // only when out of memory, which leaves the defaults below: cleared after
  // each call, before the next JNI call (as CheckJNI requires).
  static jmethodID getClass = method(findClass("java/lang/Object"), "getClass", "()Ljava/lang/Class;");
  static jmethodID getName = method(findClass("java/lang/Class"), "getName", "()Ljava/lang/String;");
  static jmethodID getMessage = method(findClass("java/lang/Throwable"), "getMessage", "()Ljava/lang/String;");
  auto read = [e](jobject o, jmethodID m) {
    jobject r = e->CallObjectMethod(o, m);
    e->ExceptionClear();
    return r;
  };
  jobject cls = read(t, getClass);
  auto name = static_cast<jstring>(cls ? read(cls, getName) : nullptr);
  auto message = static_cast<jstring>(read(t, getMessage));
  String className = name ? fromJString(e, name, "") : String::fromLatin1("java.lang.Throwable");
  Error err = makeError(String::fromLatin1("Error"), message ? fromJString(e, message, "") : className);
  err->code = className;
  // The exception itself, for nativeError: a global reference, kept with the error.
  err->native = std::make_shared<const NativeRef>(wrap(e, e->NewLocalRef(t), "an exception"));
  return err;
}

}  // namespace

Error errorOf(JNIEnv* e, jobject t) { return errorOf(e, t, true); }

Error errorOf(const NativeRef& throwable) { return errorOf(env(), unwrap(throwable), false); }

Opt<NativeRef> nativeError(const Error& error) {
  if (!error || !error->native) return Opt<NativeRef>(null);
  return *std::static_pointer_cast<const NativeRef>(error->native);
}

NativeBuffer adoptByteBuffer(const NativeRef& buffer) {
  JNIEnv* e = env();
  jobject b = unwrap(buffer);
  auto* data = static_cast<uint8_t*>(e->GetDirectBufferAddress(b));
  jlong capacity = e->GetDirectBufferCapacity(b);
  if (!data || capacity < 0)
    failWith("TypeError",
             "adoptByteBuffer needs a direct ByteBuffer (ByteBuffer.allocateDirect), not one over a Java array");

  static jmethodID isReadOnly = method(findClass("java/nio/Buffer"), "isReadOnly", "()Z");
  jboolean readOnly = e->CallBooleanMethod(b, isReadOnly);
  check(e);
  if (readOnly) failWith("TypeError", "adoptByteBuffer needs a writable ByteBuffer, not a read-only one");

  // Released on whichever thread lets the bytes go: env() attaches it.
  jobject held = e->NewGlobalRef(b);
  return NativeBufferObject::adopt(data, static_cast<size_t>(capacity),
                                   [held](uint8_t*, size_t) { env()->DeleteGlobalRef(held); });
}

NativeHandle byteBufferHandle(const NativeRef& buffer) {
  JNIEnv* e = env();
  jobject b = unwrap(buffer);
  void* data = e->GetDirectBufferAddress(b);
  if (!data)
    failWith("TypeError", "handleOf needs a direct ByteBuffer (ByteBuffer.allocateDirect), not one over a Java array");

  // Released on whichever thread lets it go: env() attaches it.
  jobject held = e->NewGlobalRef(b);
  return NativeHandleObject::make(data, [held] { env()->DeleteGlobalRef(held); }, String::fromLatin1("ByteBuffer"));
}

namespace {

/// AHardwareBuffer_Desc, as <android/hardware_buffer.h> lays it out.
struct HardwareBufferDesc {
  uint32_t width;
  uint32_t height;
  uint32_t layers;
  uint32_t format;
  uint64_t usage;
  uint32_t stride;
  uint32_t rfu0;
  uint64_t rfu1;
};

/// The NDK's AHardwareBuffer functions (API 26, in libnativewindow.so),
/// found at run time, since an app runs from API 24; null without them.
struct HardwareBuffers {
  using FromJava = void* (*)(JNIEnv*, jobject);
  using Hold = void (*)(void*);
  using Describe = void (*)(const void*, HardwareBufferDesc*);
  using Lock = int (*)(void*, uint64_t, int32_t, const void*, void**);
  using Unlock = int (*)(void*, int32_t*);
  FromJava fromJava = nullptr;
  Hold acquire = nullptr;
  Hold release = nullptr;
  Describe describe = nullptr;
  Lock lock = nullptr;
  Unlock unlock = nullptr;
};

const HardwareBuffers& hardwareBuffers() {
  static const HardwareBuffers found = [] {
    HardwareBuffers h;
#ifdef __ANDROID__
    // AHardwareBuffer_fromHardwareBuffer is libandroid's (<android/hardware_buffer_jni.h>), the
    // rest libnativewindow's, which libandroid depends on: a lookup through libandroid's handle
    // searches both.
    void* lib = dlopen("libandroid.so", RTLD_NOW);
    if (!lib) lib = dlopen("libnativewindow.so", RTLD_NOW);
    void* window = dlopen("libnativewindow.so", RTLD_NOW);
    auto find = [&](const char* name) -> void* {
      void* f = lib ? dlsym(lib, name) : nullptr;
      return f ? f : window ? dlsym(window, name) : nullptr;
    };
    h.fromJava = reinterpret_cast<HardwareBuffers::FromJava>(find("AHardwareBuffer_fromHardwareBuffer"));
    h.acquire = reinterpret_cast<HardwareBuffers::Hold>(find("AHardwareBuffer_acquire"));
    h.release = reinterpret_cast<HardwareBuffers::Hold>(find("AHardwareBuffer_release"));
    h.describe = reinterpret_cast<HardwareBuffers::Describe>(find("AHardwareBuffer_describe"));
    h.lock = reinterpret_cast<HardwareBuffers::Lock>(find("AHardwareBuffer_lock"));
    h.unlock = reinterpret_cast<HardwareBuffers::Unlock>(find("AHardwareBuffer_unlock"));
#endif
    return h;
  }();
  return found;
}

/// The bytes a pixel of a single-plane format takes (AHARDWAREBUFFER_FORMAT_*),
/// 0 for a planar or compressed one; a BLOB's bytes are its width.
size_t bytesPerPixel(uint32_t format) {
  switch (format) {
    case 1:     // R8G8B8A8_UNORM
    case 2:     // R8G8B8X8_UNORM
    case 0x2b:  // R10G10B10A2_UNORM
      return 4;
    case 3:  // R8G8B8_UNORM
      return 3;
    case 4:  // R5G6B5_UNORM
      return 2;
    case 0x16:  // R16G16B16A16_FLOAT
      return 8;
    case 0x21:  // BLOB
    case 0x38:  // R8_UNORM
      return 1;
    default:
      return 0;
  }
}

}  // namespace

NativeBuffer adoptHardwareBuffer(const NativeRef& buffer, const String& access) {
  const bool writable = access == String::fromLatin1("readwrite");
  if (!writable && !(access == String::fromLatin1("read")))
    failWith("TypeError", "adoptHardwareBuffer's access is \"read\" or \"readwrite\"");

  const HardwareBuffers& h = hardwareBuffers();
  if (!h.fromJava || !h.acquire || !h.release || !h.describe || !h.lock || !h.unlock)
    failWith("TypeError", "adoptHardwareBuffer needs Android 8 (API 26), whose NDK gives an AHardwareBuffer");

  void* native = h.fromJava(env(), unwrap(buffer));
  if (!native) failWith("TypeError", "adoptHardwareBuffer: the HardwareBuffer has no AHardwareBuffer (was it closed?)");

  HardwareBufferDesc desc{};
  h.describe(native, &desc);
  const size_t pixel = bytesPerPixel(desc.format);
  if (!pixel || desc.layers != 1)
    failWith("TypeError", "adoptHardwareBuffer needs a buffer of one layer and one plane (RGBA_8888, RGB_565, BLOB…), not format " +
                              std::to_string(desc.format));

  // The CPU uses it was made for: AHARDWAREBUFFER_USAGE_CPU_READ_MASK, and the write mask.
  const uint64_t read = desc.usage & 0xFu, write = desc.usage & 0xF0u;
  if (!read || (writable && !write))
    failWith("TypeError", writable ? "adoptHardwareBuffer: the HardwareBuffer wasn't made for CPU reads and writes "
                                     "(USAGE_CPU_READ_OFTEN | USAGE_CPU_WRITE_OFTEN)"
                                   : "adoptHardwareBuffer: the HardwareBuffer wasn't made for CPU reads (USAGE_CPU_READ_OFTEN)");

  void* address = nullptr;
  const uint64_t usage = read | (writable ? write : 0);
  if (h.lock(native, usage, -1, nullptr, &address) != 0 || !address)
    failWith("Error", "adoptHardwareBuffer: the HardwareBuffer could not be locked");

  // Held for the bytes, which the Java object may be closed under.
  h.acquire(native);
  const size_t size = desc.format == 0x21 ? desc.width : static_cast<size_t>(desc.stride) * desc.height * pixel;
  auto unlock = h.unlock;
  auto release = h.release;
  NativeBufferObject::Destroy destroy = [native, unlock, release](uint8_t*, size_t) {
    unlock(native, nullptr);
    release(native);
  };
  try {
    auto* data = static_cast<uint8_t*>(address);
    return writable ? NativeBufferObject::adopt(data, size, std::move(destroy), nullptr, String::fromLatin1("HardwareBuffer"))
                    : NativeBufferObject::adoptReadOnly(data, size, std::move(destroy), nullptr,
                                                        String::fromLatin1("HardwareBuffer"));
  } catch (...) {
    unlock(native, nullptr);
    release(native);
    throw;
  }
}

NativeHandle hardwareBufferHandle(const NativeRef& buffer) {
  const HardwareBuffers& h = hardwareBuffers();
  if (!h.fromJava || !h.acquire || !h.release)
    failWith("TypeError", "handleOf(HardwareBuffer) needs Android 8 (API 26), whose NDK gives an AHardwareBuffer");

  void* native = h.fromJava(env(), unwrap(buffer));
  if (!native) failWith("TypeError", "handleOf: the HardwareBuffer has no AHardwareBuffer (was it closed?)");

  // Acquired for the handle: the Java object may be closed meanwhile.
  h.acquire(native);
  auto release = h.release;
  return NativeHandleObject::make(native, [release, native] { release(native); }, String::fromLatin1("AHardwareBuffer"));
}

void close(const NativeRef& closeable) {
  JNIEnv* e = env();
  static jmethodID m = method(findClass("java/lang/AutoCloseable"), "close", "()V");
  e->CallVoidMethod(unwrap(closeable), m);
  check(e);
}

NativeRef wrap(JNIEnv* e, jobject local, const char* what) {
  if (!local) failWith("TypeError", std::string(what) + " returned null");
  jobject global = e->NewGlobalRef(local);
  e->DeleteLocalRef(local);
  return NativeRef(global, releaseGlobal, sameObject, nullptr, &weakOps);
}

Opt<NativeRef> wrapOpt(JNIEnv* e, jobject local) {
  if (!local) return Opt<NativeRef>(null);
  return wrap(e, local, "");
}

jstring toJString(JNIEnv* e, const String& s) {
  std::u16string units = s.toUtf16();
  return e->NewString(reinterpret_cast<const jchar*>(units.data()), static_cast<jsize>(units.size()));
}

String fromJString(JNIEnv* e, jstring s, const char* what) {
  if (!s) failWith("TypeError", std::string(what) + " returned null");
  jsize n = e->GetStringLength(s);
  std::u16string units(static_cast<size_t>(n), u'\0');
  e->GetStringRegion(s, 0, n, reinterpret_cast<jchar*>(units.data()));
  return String::fromUtf16(units);
}

Opt<String> fromJStringOpt(JNIEnv* e, jstring s) {
  if (!s) return Opt<String>(null);
  return fromJString(e, s, "");
}

String charSequenceToString(JNIEnv* e, jobject s, const char* what) {
  if (!s) failWith("TypeError", std::string(what) + " returned null");
  static jmethodID toString = method(findClass("java/lang/CharSequence"), "toString", "()Ljava/lang/String;");
  auto str = static_cast<jstring>(e->CallObjectMethod(s, toString));
  check(e);
  return fromJString(e, str, what);
}

Opt<String> charSequenceToStringOpt(JNIEnv* e, jobject s) {
  if (!s) return Opt<String>(null);
  return charSequenceToString(e, s, "");
}

jbyteArray toByteArray(JNIEnv* e, const Bytes& b) {
  auto n = static_cast<jsize>(b.size());
  jbyteArray out = e->NewByteArray(n);
  e->SetByteArrayRegion(out, 0, n, reinterpret_cast<const jbyte*>(b.data()));
  return out;
}

jobjectArray toStringArray(JNIEnv* e, const Array<String>& a) {
  auto n = static_cast<jsize>(a.size());
  jobjectArray out = e->NewObjectArray(n, findClass("java/lang/String"), nullptr);
  for (jsize i = 0; i < n; i++) {
    jstring s = toJString(e, a.at(static_cast<size_t>(i)));
    e->SetObjectArrayElement(out, i, s);
    e->DeleteLocalRef(s);
  }
  return out;
}

Array<BigInt> fromLongArray(JNIEnv* e, jlongArray a, const char* what) {
  if (!a) failWith("TypeError", std::string(what) + " returned null");
  jsize n = e->GetArrayLength(a);
  std::vector<jlong> buf(static_cast<size_t>(n));
  e->GetLongArrayRegion(a, 0, n, buf.data());
  Array<BigInt> out;
  for (jlong v : buf) out.push(BigInt(v));
  return out;
}

Array<double> fromIntArray(JNIEnv* e, jintArray a, const char* what) {
  if (!a) failWith("TypeError", std::string(what) + " returned null");
  jsize n = e->GetArrayLength(a);
  std::vector<jint> buf(static_cast<size_t>(n));
  e->GetIntArrayRegion(a, 0, n, buf.data());
  Array<double> out;
  for (jint v : buf) out.push(static_cast<double>(v));
  return out;
}

Bytes fromByteArray(JNIEnv* e, jbyteArray a, const char* what) {
  if (!a) failWith("TypeError", std::string(what) + " returned null");
  jsize n = e->GetArrayLength(a);
  std::vector<uint8_t> buf(static_cast<size_t>(n));
  e->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte*>(buf.data()));
  return Bytes(std::move(buf));
}

Array<String> fromStringArray(JNIEnv* e, jobjectArray a, const char* what) {
  if (!a) failWith("TypeError", std::string(what) + " returned null");
  jsize n = e->GetArrayLength(a);
  Array<String> out;
  for (jsize i = 0; i < n; i++) {
    auto s = static_cast<jstring>(e->GetObjectArrayElement(a, i));
    // Null elements have no place in string[]: read them as empty strings.
    out.push(s ? fromJString(e, s, what) : String());
    if (s) e->DeleteLocalRef(s);
  }
  return out;
}

jlongArray toLongArray(JNIEnv* e, const Array<BigInt>& a, const char* what) {
  auto n = static_cast<jsize>(a.size());
  std::vector<jlong> buf(static_cast<size_t>(n));
  for (jsize i = 0; i < n; i++) buf[static_cast<size_t>(i)] = toNativeInteger<jlong>(a.at(static_cast<size_t>(i)), what);
  jlongArray out = e->NewLongArray(n);
  e->SetLongArrayRegion(out, 0, n, buf.data());
  return out;
}

jintArray toIntArray(JNIEnv* e, const Array<double>& a) {
  auto n = static_cast<jsize>(a.size());
  jintArray out = e->NewIntArray(n);
  std::vector<jint> buf(static_cast<size_t>(n));
  for (jsize i = 0; i < n; i++) buf[static_cast<size_t>(i)] = static_cast<jint>(toInt32(a.at(static_cast<size_t>(i))));
  e->SetIntArrayRegion(out, 0, n, buf.data());
  return out;
}

void returnedNull(const char* what) { failWith("TypeError", std::string(what) + " returned null"); }

jobjectArray listElements(JNIEnv* e, jobject list, const char* what) {
  if (!list) returnedNull(what);

  static jmethodID toArray = method(findClass("java/util/Collection"), "toArray", "()[Ljava/lang/Object;");
  auto a = static_cast<jobjectArray>(e->CallObjectMethod(list, toArray));
  check(e);
  return a;
}

jobject newList(JNIEnv* e, jsize n) {
  static jclass cls = findClass("java/util/ArrayList");
  static jmethodID init = method(cls, "<init>", "(I)V");
  jobject list = e->NewObject(cls, init, n);
  check(e);
  return list;
}

void listAdd(JNIEnv* e, jobject list, jobject element) {
  static jmethodID add = method(findClass("java/util/List"), "add", "(Ljava/lang/Object;)Z");
  e->CallBooleanMethod(list, add, element);
  check(e);
}

namespace {

/// A Java array of primitives as numbers (or booleans), read in one copy.
template <class R, class A, class J>
Array<R> fromPrimitives(JNIEnv* e, A a, void (JNIEnv::*get)(A, jsize, jsize, J*), const char* what) {
  if (!a) returnedNull(what);

  jsize n = e->GetArrayLength(a);
  std::vector<J> buf(static_cast<size_t>(n));
  (e->*get)(a, 0, n, buf.data());

  Array<R> out;
  for (J v : buf) out.push(static_cast<R>(v));
  return out;
}

/// Numbers (or booleans) as a Java array of primitives, each converted by `to`.
template <class A, class J, class T, class F>
A toPrimitives(JNIEnv* e, const Array<T>& a, A (JNIEnv::*make)(jsize), void (JNIEnv::*set)(A, jsize, jsize, const J*), F to) {
  auto n = static_cast<jsize>(a.size());
  A out = (e->*make)(n);

  std::vector<J> buf(static_cast<size_t>(n));
  for (jsize i = 0; i < n; i++) buf[static_cast<size_t>(i)] = to(a.at(static_cast<size_t>(i)));
  (e->*set)(out, 0, n, buf.data());
  return out;
}

}  // namespace

Array<double> fromShortArray(JNIEnv* e, jshortArray a, const char* what) { return fromPrimitives<double>(e, a, &JNIEnv::GetShortArrayRegion, what); }
Array<double> fromCharArray(JNIEnv* e, jcharArray a, const char* what) { return fromPrimitives<double>(e, a, &JNIEnv::GetCharArrayRegion, what); }
Array<double> fromFloatArray(JNIEnv* e, jfloatArray a, const char* what) { return fromPrimitives<double>(e, a, &JNIEnv::GetFloatArrayRegion, what); }
Array<double> fromDoubleArray(JNIEnv* e, jdoubleArray a, const char* what) { return fromPrimitives<double>(e, a, &JNIEnv::GetDoubleArrayRegion, what); }

Array<bool> fromBooleanArray(JNIEnv* e, jbooleanArray a, const char* what) {
  if (!a) returnedNull(what);

  jsize n = e->GetArrayLength(a);
  std::vector<jboolean> buf(static_cast<size_t>(n));
  e->GetBooleanArrayRegion(a, 0, n, buf.data());

  Array<bool> out;
  for (jboolean v : buf) out.push(v == JNI_TRUE);
  return out;
}

jshortArray toShortArray(JNIEnv* e, const Array<double>& a) {
  return toPrimitives<jshortArray, jshort>(e, a, &JNIEnv::NewShortArray, &JNIEnv::SetShortArrayRegion, [](double v) { return static_cast<jshort>(toInt32(v)); });
}
jcharArray toCharArray(JNIEnv* e, const Array<double>& a) {
  return toPrimitives<jcharArray, jchar>(e, a, &JNIEnv::NewCharArray, &JNIEnv::SetCharArrayRegion, [](double v) { return static_cast<jchar>(toInt32(v)); });
}
jfloatArray toFloatArray(JNIEnv* e, const Array<double>& a) {
  return toPrimitives<jfloatArray, jfloat>(e, a, &JNIEnv::NewFloatArray, &JNIEnv::SetFloatArrayRegion, [](double v) { return static_cast<jfloat>(v); });
}
jdoubleArray toDoubleArray(JNIEnv* e, const Array<double>& a) {
  return toPrimitives<jdoubleArray, jdouble>(e, a, &JNIEnv::NewDoubleArray, &JNIEnv::SetDoubleArrayRegion, [](double v) { return v; });
}
jbooleanArray toBooleanArray(JNIEnv* e, const Array<bool>& a) {
  return toPrimitives<jbooleanArray, jboolean>(e, a, &JNIEnv::NewBooleanArray, &JNIEnv::SetBooleanArrayRegion, [](bool v) { return static_cast<jboolean>(v ? JNI_TRUE : JNI_FALSE); });
}

// --- proxies ---------------------------------------------------------------------------

namespace {

struct ProxyTarget {
  std::pair<const void*, std::string> key;
  std::unordered_map<std::string, ProxyMethod> methods;
  /// The actor that made it, where what its methods captured is released.
  Actor* actor = &currentActor();
  /// What lives as long as the Java object: an OS-made instance's hold on module state.
  std::shared_ptr<void> keep;
};

/// The Java object the OS made that the next subclassFor of its class, on this thread, stands for.
struct Adopting {
  jobject self = nullptr;
  const char* cls = nullptr;
  jlong handle = 0;
};
thread_local Adopting* adopting = nullptr;

std::mutex osClassesMutex;
std::unordered_map<std::string, OsFactory>& osClasses() {
  static auto* m = new std::unordered_map<std::string, OsFactory>();
  return *m;
}

struct ProxyEntry {
  jweak ref = nullptr;
  ProxyTarget* target = nullptr;
};

struct KeyHash {
  size_t operator()(const std::pair<const void*, std::string>& k) const { return std::hash<const void*>()(k.first) ^ std::hash<std::string>()(k.second); }
};

std::mutex proxiesMutex;
std::unordered_map<std::pair<const void*, std::string>, ProxyEntry, KeyHash>& proxies() {
  static auto* m = new std::unordered_map<std::pair<const void*, std::string>, ProxyEntry, KeyHash>();
  return *m;
}

void releaseProxy(JNIEnv* e, jlong handle);

/// A proxy method's call. What Lucent code throws is reported, as for any
/// platform callback (callNow), and the call returns null: NativeProxy
/// answers a method that returns a primitive with its zero value (0,
/// false), not a NullPointerException hiding the error.
jobject JNICALL proxyCall(JNIEnv* e, jclass, jlong handle, jstring method, jobjectArray args) {
  return reported(e, "Java callback", static_cast<jobject>(nullptr), [&]() -> jobject {
    auto* t = reinterpret_cast<ProxyTarget*>(handle);
    const char* chars = e->GetStringUTFChars(method, nullptr);
    if (!chars) return nullptr;  // OutOfMemoryError pending
    std::string name(chars);
    e->ReleaseStringUTFChars(method, chars);
    auto it = t->methods.find(name);
    if (it == t->methods.end()) {
      e->ThrowNew(e->FindClass("java/lang/AbstractMethodError"), ("Lucent does not implement " + name).c_str());
      return nullptr;
    }
    return it->second(e, args);
  });
}

jboolean JNICALL proxyHas(JNIEnv* e, jclass, jlong handle, jstring key) {
  return reported(e, "Java callback", static_cast<jboolean>(JNI_FALSE), [&] {
    auto* t = reinterpret_cast<ProxyTarget*>(handle);
    const char* chars = e->GetStringUTFChars(key, nullptr);
    if (!chars) return static_cast<jboolean>(JNI_FALSE);
    bool found = t->methods.count(chars) > 0;
    e->ReleaseStringUTFChars(key, chars);
    return found ? static_cast<jboolean>(JNI_TRUE) : static_cast<jboolean>(JNI_FALSE);
  });
}

void JNICALL proxyRelease(JNIEnv* e, jclass, jlong handle) {
  reported(e, "a proxy's release", [&] { releaseProxy(e, handle); });
}

/// NativeProxy.adopt: a generated class the OS made asks for its Lucent side.
/// What fails (no such class, its constructor threw) is thrown to Java, to
/// whatever made it.
jlong JNICALL proxyAdopt(JNIEnv* e, jclass, jobject self, jstring cls, jobjectArray args) {
  try {
    const char* chars = e->GetStringUTFChars(cls, nullptr);
    if (!chars) return 0;  // OutOfMemoryError pending
    std::string name(chars);
    e->ReleaseStringUTFChars(cls, chars);

    OsFactory make = nullptr;
    {
      std::lock_guard<std::mutex> g(osClassesMutex);
      auto it = osClasses().find(name);
      if (it != osClasses().end()) make = it->second;
    }
    if (!make) throwError(String::fromLatin1("Error"), String::fromUtf8("no Lucent class is " + name + " in this build"));
    return make(e, self, args);
  } catch (...) {
    if (e->ExceptionCheck()) return 0;
    throwToJava(e, currentError(std::current_exception()));
    return 0;
  }
}

void releaseProxy(JNIEnv* e, jlong handle) {
  auto* t = reinterpret_cast<ProxyTarget*>(handle);
  {
    std::lock_guard<std::mutex> g(proxiesMutex);
    auto it = proxies().find(t->key);
    if (it != proxies().end() && it->second.target == t) {
      e->DeleteWeakGlobalRef(it->second.ref);
      proxies().erase(it);
    }
  }
  // Called on Java's finalizer thread: what the methods captured (Lucent
  // values) is released on the actor that made them.
  postCallback(*t->actor, [t] { delete t; });
}

jclass nativeProxyClass(JNIEnv* e) {
  static jclass cls = [&] {
    jclass c = findClass("dev/lucent/NativeProxy");
    JNINativeMethod natives[] = {
        {const_cast<char*>("has"), const_cast<char*>("(JLjava/lang/String;)Z"), reinterpret_cast<void*>(proxyHas)},
        {const_cast<char*>("call"), const_cast<char*>("(JLjava/lang/String;[Ljava/lang/Object;)Ljava/lang/Object;"), reinterpret_cast<void*>(proxyCall)},
        {const_cast<char*>("release"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(proxyRelease)},
        {const_cast<char*>("adoptNative"), const_cast<char*>("(Ljava/lang/Object;Ljava/lang/String;[Ljava/lang/Object;)J"), reinterpret_cast<void*>(proxyAdopt)},
    };
    e->RegisterNatives(c, natives, 4);
    check(e);
    return c;
  }();
  return cls;
}

jobject boxWith(JNIEnv* e, const char* cls, const char* sig, jvalue v) {
  jclass c = findClass(cls);
  jmethodID valueOf = staticMethod(c, "valueOf", sig);
  jobject r = e->CallStaticObjectMethodA(c, valueOf, &v);
  check(e);
  return r;
}

}  // namespace

namespace {

/** The Java object for `key`, made by `make` (given the handle) unless Java still holds one. */
jobject cachedJavaObject(JNIEnv* e, std::pair<const void*, std::string> key, std::initializer_list<std::pair<const char*, ProxyMethod>> methods, const std::function<jobject(jlong)>& make) {
  nativeProxyClass(e);
  {
    std::lock_guard<std::mutex> g(proxiesMutex);
    auto it = proxies().find(key);
    if (it != proxies().end()) {
      jobject local = e->NewLocalRef(it->second.ref);
      if (local) return local;
    }
  }
  auto* t = new ProxyTarget{key, {}};
  for (const auto& [name, fn] : methods) t->methods.emplace(name, fn);
  jobject o = make(reinterpret_cast<jlong>(t));
  if (e->ExceptionCheck()) {
    delete t;
    rethrowPending(e);
  }
  std::lock_guard<std::mutex> g(proxiesMutex);
  ProxyEntry& slot = proxies()[key];
  if (slot.ref) e->DeleteWeakGlobalRef(slot.ref);
  slot = {e->NewWeakGlobalRef(o), t};
  return o;
}

}  // namespace

jobject proxyFor(JNIEnv* e, const char* iface, const void* identity, std::initializer_list<std::pair<const char*, ProxyMethod>> methods,
                 const char* variant) {
  std::string key = variant ? std::string(iface) + "#" + variant : std::string(iface);
  return cachedJavaObject(e, {identity, key}, methods, [&](jlong handle) {
    jclass cls = nativeProxyClass(e);
    static jmethodID create = staticMethod(cls, "create", "(Ljava/lang/Class;J)Ljava/lang/Object;");
    return e->CallStaticObjectMethod(cls, create, findClass(iface), handle);
  });
}

jobject subclassFor(JNIEnv* e, const char* cls, const void* identity, std::initializer_list<std::pair<const char*, ProxyMethod>> methods) {
  return cachedJavaObject(e, {identity, cls}, methods, [&](jlong handle) -> jobject {
    // The OS made the object: it is the instance's, with this handle.
    if (adopting && !adopting->handle && std::strcmp(adopting->cls, cls) == 0) {
      adopting->handle = handle;
      return e->NewLocalRef(adopting->self);
    }
    jclass c = findClass(cls);
    return e->NewObject(c, method(c, "<init>", "(J)V"), handle);
  });
}

bool registerOsClass(const char* cls, OsFactory make) {
  std::lock_guard<std::mutex> g(osClassesMutex);
  osClasses()[cls] = make;
  return true;
}

jlong adoptSubclass(JNIEnv* e, jobject self, const char* cls, std::shared_ptr<void> keep, const std::function<jobject()>& convert) {
  Adopting adoption{self, cls, 0};
  Adopting* outer = adopting;
  adopting = &adoption;
  jobject o = nullptr;
  try {
    o = convert();
  } catch (...) {
    adopting = outer;
    throw;
  }
  adopting = outer;
  if (o) e->DeleteLocalRef(o);
  if (!adoption.handle) throwError(String::fromLatin1("Error"), String::fromUtf8(std::string("the Lucent side of ") + cls + " was made elsewhere"));
  reinterpret_cast<ProxyTarget*>(adoption.handle)->keep = std::move(keep);
  return adoption.handle;
}

namespace {

/** LucentInstance.release: lets go of the lucent_object an instance's wrapper held. */
void JNICALL instanceRelease(JNIEnv* e, jclass, jlong handle) {
  reported(e, "an instance's release", [&] { lucent_release(reinterpret_cast<lucent_object>(handle)); });
}

}  // namespace

void installNatives(JNIEnv* e) {
  nativeProxyClass(e);
  jclass instance = findClass("dev/lucent/LucentInstance");
  JNINativeMethod natives[] = {
      {const_cast<char*>("release"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(instanceRelease)},
  };
  e->RegisterNatives(instance, natives, 1);
  check(e);
}

#ifdef __ANDROID__
// Found by its name: a class the OS makes calls it before Lucent registered any native.
extern "C" JNIEXPORT jlong JNICALL Java_dev_lucent_NativeProxy_adoptNative(JNIEnv* e, jclass c, jobject self, jstring cls, jobjectArray args) {
  return proxyAdopt(e, c, self, cls, args);
}

// Found by its name too: Kotlin and Java make instances before Lucent calls Java.
extern "C" JNIEXPORT void JNICALL Java_dev_lucent_LucentInstance_release(JNIEnv* e, jclass c, jlong handle) { instanceRelease(e, c, handle); }
#endif

jobject arg(JNIEnv* e, jobjectArray args, int i) { return e->GetObjectArrayElement(args, i); }

jobject detail::completionFor(JNIEnv* e, std::function<void(JNIEnv*, jobject, jobject)> settle) {
  // A fresh identity for each call: proxies are cached per identity while Java holds them.
  static std::atomic<uintptr_t> next{1};
  const void* identity = reinterpret_cast<const void*>(next.fetch_add(1));

  ProxyMethod accept = [settle = std::move(settle)](JNIEnv* env, jobjectArray args) -> jobject {
    settle(env, arg(env, args, 0), arg(env, args, 1));
    return nullptr;
  };

  return proxyFor(e, "java/util/function/BiConsumer", identity, {{"accept(Ljava/lang/Object;Ljava/lang/Object;)", accept}});
}

double unboxNumber(JNIEnv* e, jobject boxed) {
  static jmethodID doubleValue = method(findClass("java/lang/Number"), "doubleValue", "()D");
  double v = e->CallDoubleMethod(boxed, doubleValue);
  check(e);
  return v;
}

jlong unboxLong(JNIEnv* e, jobject boxed) {
  static jmethodID longValue = method(findClass("java/lang/Number"), "longValue", "()J");
  jlong v = e->CallLongMethod(boxed, longValue);
  check(e);
  return v;
}

bool unboxBoolean(JNIEnv* e, jobject boxed) {
  static jmethodID booleanValue = method(findClass("java/lang/Boolean"), "booleanValue", "()Z");
  bool v = e->CallBooleanMethod(boxed, booleanValue) == JNI_TRUE;
  check(e);
  return v;
}

jobject boxInt(JNIEnv* e, jint v) { return boxWith(e, "java/lang/Integer", "(I)Ljava/lang/Integer;", jvalue{.i = v}); }
jobject boxShort(JNIEnv* e, jshort v) { return boxWith(e, "java/lang/Short", "(S)Ljava/lang/Short;", jvalue{.s = v}); }
jobject boxByte(JNIEnv* e, jbyte v) { return boxWith(e, "java/lang/Byte", "(B)Ljava/lang/Byte;", jvalue{.b = v}); }
jobject boxChar(JNIEnv* e, jchar v) { return boxWith(e, "java/lang/Character", "(C)Ljava/lang/Character;", jvalue{.c = v}); }
jobject boxLong(JNIEnv* e, jlong v) { return boxWith(e, "java/lang/Long", "(J)Ljava/lang/Long;", jvalue{.j = v}); }
jobject boxDouble(JNIEnv* e, jdouble v) { return boxWith(e, "java/lang/Double", "(D)Ljava/lang/Double;", jvalue{.d = v}); }
jobject boxFloat(JNIEnv* e, jfloat v) { return boxWith(e, "java/lang/Float", "(F)Ljava/lang/Float;", jvalue{.f = v}); }
jobject boxBoolean(JNIEnv* e, bool v) { return boxWith(e, "java/lang/Boolean", "(Z)Ljava/lang/Boolean;", jvalue{.z = static_cast<jboolean>(v ? JNI_TRUE : JNI_FALSE)}); }

#ifdef __ANDROID__
NativeRef appContext() {
  static NativeRef* app = [] {
    JNIEnv* e = env();
    jclass cls = e->FindClass("android/app/ActivityThread");
    check(e);
    jmethodID current = e->GetStaticMethodID(cls, "currentApplication", "()Landroid/app/Application;");
    check(e);
    auto* kept = new NativeRef(wrap(e, e->CallStaticObjectMethod(cls, current), "ActivityThread.currentApplication()"));

    // Never released: not what a JavaScript runtime's teardown leaves behind.
    kept->keepForProcess();
    return kept;
  }();
  return *app;
}
#endif

namespace {
thread_local jobject hostingView = nullptr;
}  // namespace

HostViewEntry::HostViewEntry(jobject view) : outer_(hostingView) { hostingView = view; }

HostViewEntry::~HostViewEntry() { hostingView = outer_; }

Opt<NativeRef> hostContext() {
  if (!hostingView) return Opt<NativeRef>(null);

  JNIEnv* e = env();
  static jmethodID getContext = method(findClass("android/view/View"), "getContext", "()Landroid/content/Context;");
  jobject context = e->CallObjectMethod(hostingView, getContext);

  check(e);
  return wrapOpt(e, context);
}

namespace {

using ExecutorHandle = std::shared_ptr<ExecutorContext>;

/** LucentExecutor.post: runs `command` on the executor, outside its turns, as an executor runs platform work. */
jboolean JNICALL executorPost(JNIEnv* e, jclass, jlong handle, jobject command) {
  return reported(e, "an executor's execute", static_cast<jboolean>(JNI_FALSE), [&] {
    auto& executor = *reinterpret_cast<ExecutorHandle*>(handle);
    jobject runnable = e->NewGlobalRef(command);
    bool posted = executor->execute([runnable] {
      JNIEnv* env = jni::env();
      static jmethodID run = method(findClass("java/lang/Runnable"), "run", "()V");
      env->CallVoidMethod(runnable, run);
      if (env->ExceptionCheck()) {
        // A Runnable that throws on an executor: reported, as a callback's error is.
        try {
          rethrowPending(env);
        } catch (...) {
          reportUncaught(std::current_exception(), "a Runnable on an executor");
        }
      }
      env->DeleteGlobalRef(runnable);
    });
    if (!posted) e->DeleteGlobalRef(runnable);
    return posted ? static_cast<jboolean>(JNI_TRUE) : static_cast<jboolean>(JNI_FALSE);
  });
}

/** LucentExecutor.release, from its finalizer: the Java object's hold on the executor ends. */
void JNICALL executorRelease(JNIEnv* e, jclass, jlong handle) {
  reported(e, "an executor's release", [&] { delete reinterpret_cast<ExecutorHandle*>(handle); });
}

jclass lucentExecutorClass(JNIEnv* e) {
  static jclass cls = [&] {
    jclass c = findClass("dev/lucent/LucentExecutor");
    JNINativeMethod natives[] = {
        {const_cast<char*>("post"), const_cast<char*>("(JLjava/lang/Runnable;)Z"), reinterpret_cast<void*>(executorPost)},
        {const_cast<char*>("release"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(executorRelease)},
    };
    e->RegisterNatives(c, natives, 2);
    check(e);
    return c;
  }();
  return cls;
}

}  // namespace

jobject executorOf(JNIEnv* e, const std::shared_ptr<ExecutorContext>& executor) {
  jclass c = lucentExecutorClass(e);
  static jmethodID init = method(c, "<init>", "(JLjava/lang/String;)V");
  auto* handle = new ExecutorHandle(executor);
  jstring label = e->NewStringUTF(executor->label().c_str());
  jobject o = e->NewObject(c, init, reinterpret_cast<jlong>(handle), label);
  e->DeleteLocalRef(label);
  if (e->ExceptionCheck()) {
    delete handle;
    rethrowPending(e);
  }
  return o;
}

#ifdef __ANDROID__
bool available(double api) {
  static int level = [] {
    char value[PROP_VALUE_MAX] = {0};
    __system_property_get("ro.build.version.sdk", value);
    return std::atoi(value);
  }();
  return level >= api;
}
#endif

}  // namespace lucent::jni

namespace lucent::jni {

// --- the Kotlin API's JNI (decision 0116) --------------------------------------------

lucent_string EntryArgs::string(jstring s) {
  if (!s) return lucent_string{nullptr, 0};
  strings_.push_back(fromJString(env_, s, "a string").toUtf8());
  return lucent_string{strings_.back().data(), strings_.back().size()};
}

lucent_bytes EntryArgs::bytes(jbyteArray b) {
  if (!b) return lucent_bytes{nullptr, 0};
  jsize n = env_->GetArrayLength(b);
  bytes_.emplace_back(static_cast<size_t>(n));
  if (n) env_->GetByteArrayRegion(b, 0, n, reinterpret_cast<jbyte*>(bytes_.back().data()));
  return lucent_bytes{bytes_.back().data(), bytes_.back().size()};
}

lucent_object EntryArgs::instance(jobject o) {
  if (!o) return nullptr;
  static jmethodID handle = method(findClass("dev/lucent/LucentInstance"), "handle", "()J");
  jlong h = env_->CallLongMethod(o, handle);
  check(env_);
  return reinterpret_cast<lucent_object>(h);
}

lucent_value EntryArgs::value(jobject o) {
  JNIEnv* e = env_;
  lucent_value v{LUCENT_NULL, {}};
  if (!o) return v;
  auto is = [&](const char* cls) { return e->IsInstanceOf(o, findClass(cls)); };
  if (is("java/lang/Boolean")) {
    static jmethodID booleanValue = method(findClass("java/lang/Boolean"), "booleanValue", "()Z");
    v.kind = LUCENT_BOOLEAN;
    v.as.boolean = e->CallBooleanMethod(o, booleanValue);
    check(e);
  } else if (is("java/lang/Long")) {
    v.kind = LUCENT_BIGINT;
    v.as.bigint = unboxLong(e, o);
  } else if (is("java/lang/Number")) {
    v.kind = LUCENT_NUMBER;
    v.as.number = unboxNumber(e, o);
  } else if (is("java/lang/String")) {
    v.kind = LUCENT_STRING;
    v.as.string = string(static_cast<jstring>(o));
  } else if (is("[B")) {
    v.kind = LUCENT_BYTES;
    v.as.bytes = bytes(static_cast<jbyteArray>(o));
  } else if (is("dev/lucent/LucentInstance")) {
    v.kind = LUCENT_INSTANCE;
    v.as.instance = instance(o);
  } else if (is("java/util/List")) {
    static jclass list = findClass("java/util/List");
    static jmethodID size = method(list, "size", "()I");
    static jmethodID get = method(list, "get", "(I)Ljava/lang/Object;");
    jint n = e->CallIntMethod(o, size);
    check(e);
    values_.emplace_back(static_cast<size_t>(n), lucent_value{LUCENT_NULL, {}});
    lucent_value* items = values_.back().data();
    for (jint i = 0; i < n; i++) {
      jobject item = e->CallObjectMethod(o, get, i);
      check(e);
      items[i] = value(item);
      // A long list's items would fill the local frame: kept only where the value is the object.
      if (item && items[i].kind != LUCENT_PLATFORM_OBJECT) e->DeleteLocalRef(item);
    }
    v.kind = LUCENT_ARRAY;
    v.as.array = lucent_array{items, static_cast<size_t>(n)};
  } else if (is("java/util/Map")) {
    static jmethodID entrySet = method(findClass("java/util/Map"), "entrySet", "()Ljava/util/Set;");
    static jmethodID toArray = method(findClass("java/util/Collection"), "toArray", "()[Ljava/lang/Object;");
    static jclass entry = findClass("java/util/Map$Entry");
    static jmethodID getKey = method(entry, "getKey", "()Ljava/lang/Object;");
    static jmethodID getValue = method(entry, "getValue", "()Ljava/lang/Object;");
    static jmethodID toString = method(findClass("java/lang/Object"), "toString", "()Ljava/lang/String;");
    jobject set = e->CallObjectMethod(o, entrySet);
    check(e);
    auto entries = static_cast<jobjectArray>(e->CallObjectMethod(set, toArray));
    check(e);
    jsize n = e->GetArrayLength(entries);
    keys_.emplace_back(static_cast<size_t>(n), lucent_string{nullptr, 0});
    values_.emplace_back(static_cast<size_t>(n), lucent_value{LUCENT_NULL, {}});
    lucent_string* keys = keys_.back().data();
    lucent_value* values = values_.back().data();
    for (jsize i = 0; i < n; i++) {
      jobject at = e->GetObjectArrayElement(entries, i);
      jobject key = e->CallObjectMethod(at, getKey);
      check(e);
      auto name = static_cast<jstring>(e->CallObjectMethod(key, toString));
      check(e);
      keys[i] = string(name);
      jobject item = e->CallObjectMethod(at, getValue);
      check(e);
      values[i] = value(item);
      if (item && values[i].kind != LUCENT_PLATFORM_OBJECT) e->DeleteLocalRef(item);
      e->DeleteLocalRef(name);
      e->DeleteLocalRef(key);
      e->DeleteLocalRef(at);
    }
    v.kind = LUCENT_RECORD;
    v.as.record = lucent_record{keys, values, static_cast<size_t>(n)};
  } else {
    // Anything else is a platform object, which the entry holds with a reference of its own.
    v.kind = LUCENT_PLATFORM_OBJECT;
    v.as.object = o;
  }
  return v;
}

jobject javaOf(JNIEnv* e, double v) {
  static jclass c = findClass("java/lang/Double");
  static jmethodID valueOf = staticMethod(c, "valueOf", "(D)Ljava/lang/Double;");
  return e->CallStaticObjectMethod(c, valueOf, v);
}

jobject javaOf(JNIEnv* e, bool v) {
  static jclass c = findClass("java/lang/Boolean");
  static jmethodID valueOf = staticMethod(c, "valueOf", "(Z)Ljava/lang/Boolean;");
  return e->CallStaticObjectMethod(c, valueOf, static_cast<jboolean>(v));
}

jobject javaOf(JNIEnv* e, int64_t v) {
  static jclass c = findClass("java/lang/Long");
  static jmethodID valueOf = staticMethod(c, "valueOf", "(J)Ljava/lang/Long;");
  return e->CallStaticObjectMethod(c, valueOf, static_cast<jlong>(v));
}

jstring javaOf(JNIEnv* e, lucent_string s) {
  return toJString(e, String::fromUtf8(std::string_view(s.data ? s.data : "", s.data ? s.length : 0)));
}

jbyteArray javaOf(JNIEnv* e, lucent_bytes b) {
  jbyteArray out = e->NewByteArray(static_cast<jsize>(b.length));
  if (b.length) e->SetByteArrayRegion(out, 0, static_cast<jsize>(b.length), reinterpret_cast<const jbyte*>(b.data));
  return out;
}

namespace {

std::mutex instanceClassesLock;
std::map<std::string, std::string>& instanceClasses() {
  static std::map<std::string, std::string> classes;
  return classes;
}

}  // namespace

bool registerInstanceClass(const std::type_info& type, const char* javaClass) {
  std::lock_guard<std::mutex> lock(instanceClassesLock);
  instanceClasses()[type.name()] = javaClass;
  return true;
}

jobject javaOf(JNIEnv* e, lucent_object o) {
  if (!o) return nullptr;
  std::string name = "dev/lucent/LucentInstance";
  {
    const Object& instance = *o->instance;
    std::lock_guard<std::mutex> lock(instanceClassesLock);
    auto found = instanceClasses().find(typeid(instance).name());
    if (found != instanceClasses().end()) name = found->second;
  }
  jclass c = findClass(name.c_str());
  jmethodID init = method(c, "<init>", "(J)V");
  jobject wrapper = e->NewObject(c, init, reinterpret_cast<jlong>(o));
  if (e->ExceptionCheck()) {
    lucent_release(o);
    rethrowPending(e);
  }
  return wrapper;
}

jobject javaOf(JNIEnv* e, const lucent_value& v) {
  switch (v.kind) {
    case LUCENT_NULL:
      return nullptr;
    case LUCENT_BOOLEAN:
      return javaOf(e, v.as.boolean);
    case LUCENT_NUMBER:
      return javaOf(e, v.as.number);
    case LUCENT_BIGINT:
      return javaOf(e, static_cast<int64_t>(v.as.bigint));
    case LUCENT_STRING:
      return javaOf(e, v.as.string);
    case LUCENT_BYTES:
      return javaOf(e, v.as.bytes);
    case LUCENT_PLATFORM_OBJECT:
      return e->NewLocalRef(static_cast<jobject>(v.as.object));
    case LUCENT_INSTANCE:
      return javaOf(e, v.as.instance);
    case LUCENT_ARRAY: {
      static jclass c = findClass("java/util/ArrayList");
      static jmethodID init = method(c, "<init>", "(I)V");
      static jmethodID add = method(c, "add", "(Ljava/lang/Object;)Z");
      jobject list = e->NewObject(c, init, static_cast<jint>(v.as.array.length));
      for (size_t i = 0; i < v.as.array.length; i++) {
        jobject item = javaOf(e, v.as.array.items[i]);
        e->CallBooleanMethod(list, add, item);
        if (item) e->DeleteLocalRef(item);
        check(e);
      }
      return list;
    }
    case LUCENT_RECORD: {
      static jclass c = findClass("java/util/LinkedHashMap");
      static jmethodID init = method(c, "<init>", "()V");
      static jmethodID put = method(c, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
      jobject map = e->NewObject(c, init);
      for (size_t i = 0; i < v.as.record.length; i++) {
        jstring key = javaOf(e, v.as.record.keys[i]);
        jobject value = javaOf(e, v.as.record.values[i]);
        jobject was = e->CallObjectMethod(map, put, key, value);
        if (was) e->DeleteLocalRef(was);
        e->DeleteLocalRef(key);
        if (value) e->DeleteLocalRef(value);
        check(e);
      }
      return map;
    }
  }
  return nullptr;
}

jthrowable entryException(JNIEnv* e, const lucent_error& error) {
  static jclass c = findClass("dev/lucent/LucentException");
  static jmethodID init = method(c, "<init>", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
  jstring name = javaOf(e, error.name);
  jstring message = javaOf(e, error.message);
  jstring code = javaOf(e, error.code);
  auto thrown = static_cast<jthrowable>(e->NewObject(c, init, name, message, code));
  e->DeleteLocalRef(name);
  e->DeleteLocalRef(message);
  e->DeleteLocalRef(code);
  return thrown;
}

void throwEntryError(JNIEnv* e, const lucent_error& error) {
  jthrowable thrown = entryException(e, error);
  if (thrown) e->Throw(thrown);
}

void throwCaught(JNIEnv* e, std::exception_ptr caught) {
  // A Java exception pending already (a conversion's JNI call threw) is the one Java sees.
  if (e->ExceptionCheck()) return;
  entries::Kept kept;
  throwEntryError(e, entries::errorOf(kept, entries::caught(caught)));
}

void* entryCompletion(JNIEnv* e, jobject completion) { return e->NewGlobalRef(completion); }

void settleEntry(void* completion, const lucent_error* error, const std::function<jobject(JNIEnv*)>& value) {
  JNIEnv* e = env();
  auto done = static_cast<jobject>(completion);
  static jclass c = findClass("dev/lucent/EntryCompletion");
  static jmethodID resolve = method(c, "resolve", "(Ljava/lang/Object;)V");
  static jmethodID reject = method(c, "reject", "(Ldev/lucent/LucentException;)V");
  try {
    LocalFrame frame(e);
    if (error) {
      e->CallVoidMethod(done, reject, entryException(e, *error));
    } else {
      jobject result = value(e);
      check(e);
      e->CallVoidMethod(done, resolve, result);
    }
    check(e);
  } catch (...) {
    reportUncaught(std::current_exception(), "an export's completion");
  }
  e->DeleteGlobalRef(done);
}

}  // namespace lucent::jni

namespace lucent::entries {

// A native entry's platform objects (decision 0116): a jobject the caller still owns, held
// through a global ref of its own; one given, kept until the caller is done with it.
NativeRef nativeIn(void* object) {
  JNIEnv* e = jni::env();
  return jni::wrap(e, e->NewLocalRef(static_cast<jobject>(object)), "a native entry's argument");
}

void* nativeOut(Kept& k, const NativeRef& r) { return k.keep(r); }

}  // namespace lucent::entries

#ifdef __ANDROID__
namespace lucent {

namespace {

/// Jobs for the main thread, drained by one runnable on the main Looper:
/// posting one is a lock and a push, and a runnable (a JNI object, three
/// JNI calls) is posted only when the queue was empty, not per job.
struct MainQueue {
  std::mutex m;
  std::deque<std::function<void()>> jobs;
  bool scheduled = false;
};

MainQueue& mainQueue() {
  static auto* q = new MainQueue();
  return *q;
}

/// The main thread's id, once known: the thread the main Looper's
/// runnables run on, recorded by the first one (and by a first
/// onMainThread() asked there).
std::atomic<std::thread::id> mainThreadId{};

/// Runs what is queued, up to what was there when it began: what those
/// jobs post waits for the next runnable, so the Looper's other messages
/// (input, frames) are not starved by a job that keeps posting.
void drainMain() {
  mainThreadId.store(std::this_thread::get_id(), std::memory_order_relaxed);

  MainQueue& q = mainQueue();
  std::deque<std::function<void()>> batch;
  {
    std::lock_guard<std::mutex> g(q.m);
    batch.swap(q.jobs);
    q.scheduled = false;
  }

  for (auto& job : batch) {
    detail::runGuarded(job, "main thread job");
    job = nullptr;
  }
}

void scheduleDrain() {
  using facebook::jni::JNativeRunnable;
  JNIEnv* e = jni::env();
  static jobject handler = [e] {
    jclass looperCls = jni::findClass("android/os/Looper");
    jobject looper = e->CallStaticObjectMethod(looperCls, jni::staticMethod(looperCls, "getMainLooper", "()Landroid/os/Looper;"));
    jclass handlerCls = jni::findClass("android/os/Handler");
    jobject h = e->NewObject(handlerCls, jni::method(handlerCls, "<init>", "(Landroid/os/Looper;)V"), looper);
    jni::check(e);
    return e->NewGlobalRef(h);
  }();
  static jmethodID post = jni::method(jni::findClass("android/os/Handler"), "post", "(Ljava/lang/Runnable;)Z");
  // NativeRunnable and the HybridData behind it are app classes, which the
  // Lucent thread's class loader cannot see: create and post the runnable
  // with the app's loader.
  facebook::jni::ThreadScope::WithClassLoader([&] {
    jni::LocalFrame frame(e);
    auto runnable = JNativeRunnable::newObjectCxxArgs([] { drainMain(); });
    e->CallBooleanMethod(handler, post, runnable.get());
  });
  jni::check(e);
}

}  // namespace

void postToMain(std::function<void()> job) {
  MainQueue& q = mainQueue();
  bool schedule = false;
  {
    std::lock_guard<std::mutex> g(q.m);
    q.jobs.push_back(std::move(job));
    schedule = !std::exchange(q.scheduled, true);
  }

  if (!schedule) return;

  try {
    scheduleDrain();
  } catch (...) {
    // Not posted: the next post tries again, and the jobs stay queued.
    {
      std::lock_guard<std::mutex> g(q.m);
      q.scheduled = false;
    }
    throw;
  }
}

bool onMainThread() {
  std::thread::id self = std::this_thread::get_id();
  std::thread::id main = mainThreadId.load(std::memory_order_relaxed);
  if (main != std::thread::id()) return main == self;

  // Not known yet (nothing has run on the main Looper through Lucent):
  // ask the Looper, and remember the answer when it is yes.
  JNIEnv* e = jni::env();
  jclass looperCls = jni::findClass("android/os/Looper");
  static jmethodID mainLooper = jni::staticMethod(looperCls, "getMainLooper", "()Landroid/os/Looper;");
  static jmethodID myLooper = jni::staticMethod(looperCls, "myLooper", "()Landroid/os/Looper;");
  jni::LocalFrame frame(e);
  bool onMain = e->IsSameObject(e->CallStaticObjectMethod(looperCls, mainLooper), e->CallStaticObjectMethod(looperCls, myLooper));
  if (onMain) mainThreadId.store(self, std::memory_order_relaxed);
  return onMain;
}

}  // namespace lucent

// The app's generated lucent_entries.cpp: starts module state for its launch
// modules, or does nothing.
extern "C" void lucent_launch(void);

/// dev.lucent.LucentLaunch.launch(), from LucentInitializer on the main thread
/// once the app's appmodules has loaded (decision 0095): found by its name.
extern "C" JNIEXPORT void JNICALL Java_dev_lucent_LucentLaunch_launch(JNIEnv*, jclass) {
  try {
    lucent_launch();
  } catch (...) {
    lucent::reportUncaught(std::current_exception(), "launch");
  }
}
#endif

#endif
