// Lucent runtime — Android: JNI environment, classes, errors, the main
// Looper. Built only into Android apps (fbjni comes with React Native).
#ifdef __ANDROID__

#include "android.h"

#include <fbjni/NativeRunnable.h>
#include <fbjni/fbjni.h>
#include <sys/system_properties.h>

#include <cstdlib>
#include <mutex>
#include <string>
#include <unordered_map>

namespace lucent::jni {

JNIEnv* env() { return facebook::jni::Environment::ensureCurrentThreadIsAttached(); }

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

void rethrowPending(JNIEnv* e) {
  jthrowable t = e->ExceptionOccurred();
  e->ExceptionClear();
  jclass objectCls = e->FindClass("java/lang/Object");
  jobject cls = e->CallObjectMethod(t, e->GetMethodID(objectCls, "getClass", "()Ljava/lang/Class;"));
  jclass classCls = e->FindClass("java/lang/Class");
  auto name = static_cast<jstring>(e->CallObjectMethod(cls, e->GetMethodID(classCls, "getName", "()Ljava/lang/String;")));
  jclass throwableCls = e->FindClass("java/lang/Throwable");
  auto message = static_cast<jstring>(e->CallObjectMethod(t, e->GetMethodID(throwableCls, "getMessage", "()Ljava/lang/String;")));
  e->ExceptionClear();
  String className = name ? fromJString(e, name, "") : String::fromLatin1("java.lang.Throwable");
  Error err = makeError(String::fromLatin1("Error"), message ? fromJString(e, message, "") : className);
  err->code = className;
  throw Exception(err);
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

Array<double> fromLongArray(JNIEnv* e, jlongArray a, const char* what) {
  if (!a) failWith("TypeError", std::string(what) + " returned null");
  jsize n = e->GetArrayLength(a);
  std::vector<jlong> buf(static_cast<size_t>(n));
  e->GetLongArrayRegion(a, 0, n, buf.data());
  Array<double> out;
  for (jlong v : buf) out.push(static_cast<double>(v));
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

jlongArray toLongArray(JNIEnv* e, const Array<double>& a) {
  auto n = static_cast<jsize>(a.size());
  jlongArray out = e->NewLongArray(n);
  std::vector<jlong> buf(static_cast<size_t>(n));
  for (jsize i = 0; i < n; i++) buf[static_cast<size_t>(i)] = static_cast<jlong>(a.at(static_cast<size_t>(i)));
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

NativeRef appContext() {
  static NativeRef* app = [] {
    JNIEnv* e = env();
    jclass cls = e->FindClass("android/app/ActivityThread");
    check(e);
    jmethodID current = e->GetStaticMethodID(cls, "currentApplication", "()Landroid/app/Application;");
    check(e);
    return new NativeRef(wrap(e, e->CallStaticObjectMethod(cls, current), "ActivityThread.currentApplication()"));
  }();
  return *app;
}

bool available(double api) {
  static int level = [] {
    char value[PROP_VALUE_MAX] = {0};
    __system_property_get("ro.build.version.sdk", value);
    return std::atoi(value);
  }();
  return level >= api;
}

}  // namespace lucent::jni

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

#endif  // __ANDROID__
