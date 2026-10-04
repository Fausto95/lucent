// Lucent runtime — Android: JNI environment, classes, errors, the main
// Looper. Built into Android apps (fbjni comes with React Native); its JNI
// alone also into the desktop JNI host the tests run on a JVM
// (LUCENT_JNI_HOST), which defines env(), appContext() and available().
#if defined(__ANDROID__) || defined(LUCENT_JNI_HOST)

#include "android.h"

#ifdef __ANDROID__
#include <fbjni/NativeRunnable.h>
#include <fbjni/fbjni.h>
#include <sys/system_properties.h>
#endif

#include <atomic>
#include <cstdint>
#include <cstdlib>
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

/// The Lucent error `t` carries, removed from the list; none for other exceptions.
std::optional<Error> takeThrown(JNIEnv* e, jobject t) {
  std::lock_guard<std::mutex> g(thrownMutex);
  auto& v = thrown();
  for (auto it = v.begin(); it != v.end(); ++it) {
    if (!e->IsSameObject(it->exception, t)) continue;

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
  throw Exception(errorOf(e, t));
}

Error errorOf(JNIEnv* e, jobject t) {
  if (auto own = t ? takeThrown(e, t) : std::nullopt) return std::move(*own);
  if (!t) {
    // No exception to read: a cancelled task.
    Error err = makeError(String::fromLatin1("Error"), String::fromLatin1("cancelled"));
    err->code = String::fromLatin1("java.util.concurrent.CancellationException");
    return err;
  }
  // These throw only when out of memory, which leaves the defaults below:
  // cleared after each call, before the next JNI call (as CheckJNI requires).
  auto read = [e](jobject o, const char* cls, const char* name, const char* sig) {
    jobject r = e->CallObjectMethod(o, e->GetMethodID(e->FindClass(cls), name, sig));
    e->ExceptionClear();
    return r;
  };
  jobject cls = read(t, "java/lang/Object", "getClass", "()Ljava/lang/Class;");
  auto name = static_cast<jstring>(cls ? read(cls, "java/lang/Class", "getName", "()Ljava/lang/String;") : nullptr);
  auto message = static_cast<jstring>(read(t, "java/lang/Throwable", "getMessage", "()Ljava/lang/String;"));
  String className = name ? fromJString(e, name, "") : String::fromLatin1("java.lang.Throwable");
  Error err = makeError(String::fromLatin1("Error"), message ? fromJString(e, message, "") : className);
  err->code = className;
  return err;
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
  return NativeRef(global, releaseGlobal, sameObject);
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
};

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

jobject JNICALL proxyCall(JNIEnv* e, jclass, jlong handle, jstring method, jobjectArray args) {
  auto* t = reinterpret_cast<ProxyTarget*>(handle);
  const char* chars = e->GetStringUTFChars(method, nullptr);
  std::string name(chars);
  e->ReleaseStringUTFChars(method, chars);
  auto it = t->methods.find(name);
  if (it == t->methods.end()) {
    e->ThrowNew(e->FindClass("java/lang/AbstractMethodError"), ("Lucent does not implement " + name).c_str());
    return nullptr;
  }
  try {
    return it->second(e, args);
  } catch (...) {
    reportUncaught(std::current_exception(), "Java callback");
    return nullptr;
  }
}

jboolean JNICALL proxyHas(JNIEnv* e, jclass, jlong handle, jstring key) {
  auto* t = reinterpret_cast<ProxyTarget*>(handle);
  const char* chars = e->GetStringUTFChars(key, nullptr);
  bool found = t->methods.count(chars) > 0;
  e->ReleaseStringUTFChars(key, chars);
  return found ? JNI_TRUE : JNI_FALSE;
}

void JNICALL proxyRelease(JNIEnv* e, jclass, jlong handle) {
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
  // values) is released on the Lucent thread.
  postCallback([t] { delete t; });
}

jclass nativeProxyClass(JNIEnv* e) {
  static jclass cls = [&] {
    jclass c = findClass("dev/lucent/NativeProxy");
    JNINativeMethod natives[] = {
        {const_cast<char*>("has"), const_cast<char*>("(JLjava/lang/String;)Z"), reinterpret_cast<void*>(proxyHas)},
        {const_cast<char*>("call"), const_cast<char*>("(JLjava/lang/String;[Ljava/lang/Object;)Ljava/lang/Object;"), reinterpret_cast<void*>(proxyCall)},
        {const_cast<char*>("release"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(proxyRelease)},
    };
    e->RegisterNatives(c, natives, 3);
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
  return cachedJavaObject(e, {identity, cls}, methods, [&](jlong handle) {
    jclass c = findClass(cls);
    return e->NewObject(c, method(c, "<init>", "(J)V"), handle);
  });
}

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

#ifdef __ANDROID__
namespace lucent {

void postToMain(std::function<void()> job) {
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
    auto runnable = JNativeRunnable::newObjectCxxArgs(std::move(job));
    e->CallBooleanMethod(handler, post, runnable.get());
  });
  jni::check(e);
}

bool onMainThread() {
  JNIEnv* e = jni::env();
  jclass looperCls = jni::findClass("android/os/Looper");
  static jmethodID mainLooper = jni::staticMethod(looperCls, "getMainLooper", "()Landroid/os/Looper;");
  static jmethodID myLooper = jni::staticMethod(looperCls, "myLooper", "()Landroid/os/Looper;");
  jni::LocalFrame frame(e);
  return e->IsSameObject(e->CallStaticObjectMethod(looperCls, mainLooper), e->CallStaticObjectMethod(looperCls, myLooper));
}

}  // namespace lucent
#endif

#endif
