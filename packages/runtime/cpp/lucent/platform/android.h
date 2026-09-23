// Lucent runtime — JNI glue helpers for *.android.lucent.ts units.
#pragma once

#include <jni.h>

#include "../array.h"
#include "../jsstring.h"
#include "../native.h"

namespace lucent::jni {

/// This thread's JNIEnv, attaching it to the VM if needed.
JNIEnv* env();
/// A global reference to a class, from the app's class loader when the
/// system one cannot see it. Throws for unknown classes.
jclass findClass(const char* name);
jmethodID method(jclass cls, const char* name, const char* sig);
jmethodID staticMethod(jclass cls, const char* name, const char* sig);
jfieldID field(jclass cls, const char* name, const char* sig);
jfieldID staticField(jclass cls, const char* name, const char* sig);

/// Throws a pending Java exception as a Lucent error whose code is the
/// exception's class name (`java.lang.IllegalArgumentException`).
void rethrowPending(JNIEnv* env);
inline void check(JNIEnv* env) {
  if (env->ExceptionCheck()) rethrowPending(env);
}

/// A Lucent reference to `local` (a global ref; the local ref is deleted).
/// Throws TypeError for null.
NativeRef wrap(JNIEnv* env, jobject local, const char* what);
Opt<NativeRef> wrapOpt(JNIEnv* env, jobject local);
inline jobject unwrap(const NativeRef& r) { return static_cast<jobject>(r.get()); }
inline jobject unwrap(const Opt<NativeRef>& r) { return r.has() ? static_cast<jobject>(r.get().get()) : nullptr; }

jstring toJString(JNIEnv* env, const String& s);
String fromJString(JNIEnv* env, jstring s, const char* what);
Opt<String> fromJStringOpt(JNIEnv* env, jstring s);
jlongArray toLongArray(JNIEnv* env, const Array<double>& a);
jintArray toIntArray(JNIEnv* env, const Array<double>& a);

/// Frees the local references a glue call creates.
class LocalFrame {
 public:
  explicit LocalFrame(JNIEnv* env) : env_(env) { env_->PushLocalFrame(16); }
  ~LocalFrame() { env_->PopLocalFrame(nullptr); }
  LocalFrame(const LocalFrame&) = delete;
  LocalFrame& operator=(const LocalFrame&) = delete;

 private:
  JNIEnv* env_;
};

/// `appContext()` from lucent:android: the Application.
NativeRef appContext();
/// `available("android", api)`.
bool available(double api);

}  // namespace lucent::jni
