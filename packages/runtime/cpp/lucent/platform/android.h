// Lucent runtime — JNI glue helpers for *.android.lucent.ts units.
#pragma once

#include <jni.h>

#include <functional>
#include <initializer_list>
#include <utility>

#include "../abort.h"
#include "../array.h"
#include "../async.h"
#include "../bigint.h"
#include "../bytes.h"
#include "../function.h"
#include "../jsstring.h"
#include "../native.h"
#include "../operation.h"

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
/// A Java exception (a Throwable) as a Lucent error, coded as rethrowPending does.
Error errorOf(JNIEnv* env, jobject throwable);

/// Closes an AutoCloseable (a Closeable, a Cursor…): how a `using`
/// declaration disposes one. Throws what close() throws.
void close(const NativeRef& closeable);

/// A Lucent reference to `local` (a global ref; the local ref is deleted).
/// Throws TypeError for null.
NativeRef wrap(JNIEnv* env, jobject local, const char* what);
Opt<NativeRef> wrapOpt(JNIEnv* env, jobject local);
inline jobject unwrap(const NativeRef& r) { return static_cast<jobject>(r.get()); }
inline jobject unwrap(const Opt<NativeRef>& r) { return r.has() ? static_cast<jobject>(r.get().get()) : nullptr; }

jstring toJString(JNIEnv* env, const String& s);
String fromJString(JNIEnv* env, jstring s, const char* what);
Opt<String> fromJStringOpt(JNIEnv* env, jstring s);
/// A CharSequence (String, SpannableString…) as a string, through toString().
String charSequenceToString(JNIEnv* env, jobject s, const char* what);
Opt<String> charSequenceToStringOpt(JNIEnv* env, jobject s);

// Arrays are copied in both directions; a null reference is an absent value.
// Numbers go to Java's integral types as ToInt32 would, then narrowed (short,
// char), as JavaScript's typed arrays store them.
/// Each element exactly, or RangeError naming `what`.
jlongArray toLongArray(JNIEnv* env, const Array<BigInt>& a, const char* what);
jintArray toIntArray(JNIEnv* env, const Array<double>& a);
jshortArray toShortArray(JNIEnv* env, const Array<double>& a);
jcharArray toCharArray(JNIEnv* env, const Array<double>& a);
jfloatArray toFloatArray(JNIEnv* env, const Array<double>& a);
jdoubleArray toDoubleArray(JNIEnv* env, const Array<double>& a);
jbooleanArray toBooleanArray(JNIEnv* env, const Array<bool>& a);
jbyteArray toByteArray(JNIEnv* env, const Bytes& b);
jobjectArray toStringArray(JNIEnv* env, const Array<String>& a);
template <class T, class F>
auto toArrayOpt(JNIEnv* env, const Opt<T>& v, F convert) -> decltype(convert(env, v.get())) {
  return v.has() ? convert(env, v.get()) : nullptr;
}
Array<BigInt> fromLongArray(JNIEnv* env, jlongArray a, const char* what);
Array<double> fromIntArray(JNIEnv* env, jintArray a, const char* what);
Array<double> fromShortArray(JNIEnv* env, jshortArray a, const char* what);
Array<double> fromCharArray(JNIEnv* env, jcharArray a, const char* what);
Array<double> fromFloatArray(JNIEnv* env, jfloatArray a, const char* what);
Array<double> fromDoubleArray(JNIEnv* env, jdoubleArray a, const char* what);
Array<bool> fromBooleanArray(JNIEnv* env, jbooleanArray a, const char* what);
Bytes fromByteArray(JNIEnv* env, jbyteArray a, const char* what);
Array<String> fromStringArray(JNIEnv* env, jobjectArray a, const char* what);
template <class T, class A, class F>
Opt<T> fromArrayOpt(JNIEnv* env, A a, F convert) {
  if (!a) return Opt<T>(null);
  return convert(env, a, "");
}

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

[[noreturn]] void returnedNull(const char* what);

/// A Java array of objects (or of arrays) as a Lucent array: `each` gets
/// every element as a local reference, which is freed once it has run.
template <class T, class F>
Array<T> fromObjectArray(JNIEnv* env, jobjectArray a, F each, const char* what) {
  if (!a) returnedNull(what);

  jsize n = env->GetArrayLength(a);
  Array<T> out;
  for (jsize i = 0; i < n; i++) {
    LocalFrame frame(env);
    out.push(each(env->GetObjectArrayElement(a, i)));
  }
  return out;
}

/// A Lucent array as a Java array of `elementClass` (a class, or an array
/// type's descriptor): `each` gives every element's reference, a local one
/// freed once it is stored.
template <class T, class F>
jobjectArray toObjectArray(JNIEnv* env, const Array<T>& a, const char* elementClass, F each) {
  auto n = static_cast<jsize>(a.size());
  jobjectArray out = env->NewObjectArray(n, findClass(elementClass), nullptr);
  for (jsize i = 0; i < n; i++) {
    LocalFrame frame(env);
    env->SetObjectArrayElement(out, i, each(a.at(static_cast<size_t>(i))));
  }
  return out;
}

// --- Kotlin's read-only lists, copied ------------------------------------------------

/// A list's elements, in one copy (Collection.toArray()): a local reference.
jobjectArray listElements(JNIEnv* env, jobject list, const char* what);
/// A new java.util.ArrayList with room for `n` elements: a local reference.
jobject newList(JNIEnv* env, jsize n);
/// Appends `element` (null allowed) to `list`.
void listAdd(JNIEnv* env, jobject list, jobject element);

/// A java.util.List as a Lucent array, copied: `each` gets every element (a
/// local reference, null where the list holds null), freed once it has run.
template <class T, class F>
Array<T> fromList(JNIEnv* env, jobject list, F each, const char* what) {
  jobjectArray a = listElements(env, list, what);
  Array<T> out = fromObjectArray<T>(env, a, each, what);
  env->DeleteLocalRef(a);
  return out;
}

/// A Lucent array as a new java.util.ArrayList, copied: `each` gives every
/// element's reference (null allowed), a local one freed once it is added.
template <class T, class F>
jobject toList(JNIEnv* env, const Array<T>& a, F each) {
  auto n = static_cast<jsize>(a.size());
  jobject out = newList(env, n);
  for (jsize i = 0; i < n; i++) {
    LocalFrame frame(env);
    listAdd(env, out, each(a.at(static_cast<size_t>(i))));
  }
  return out;
}

// --- Java interfaces implemented by Lucent code --------------------------------------

/// Handles one method of a proxy: its arguments (boxed), its result (boxed,
/// or null for void).
using ProxyMethod = std::function<jobject(JNIEnv*, jobjectArray)>;

/**
 * A dev.lucent.NativeProxy implementing `iface` (a JNI class name) whose
 * methods are `methods`, keyed by name and parameter descriptor
 * (`onLocationChanged(Landroid/location/Location;)`). One per `identity` (a Lucent function or
 * object) while Java holds it, so passing the same function twice passes
 * the same object; one per `variant` too, when methods of the same
 * interface differ by where the object is passed (a Kotlin function's
 * arguments are read as each place types them). A local reference.
 */
jobject proxyFor(JNIEnv* env, const char* iface, const void* identity, std::initializer_list<std::pair<const char*, ProxyMethod>> methods,
                 const char* variant = nullptr);

/**
 * An instance of `cls` (a generated Java subclass of an SDK class, made with
 * its handle) whose overridden methods are `methods`, keyed as proxyFor's.
 * One per `identity` while Java holds it. A local reference.
 */
jobject subclassFor(JNIEnv* env, const char* cls, const void* identity, std::initializer_list<std::pair<const char*, ProxyMethod>> methods);

/// The i-th argument of a proxy call (a local reference; boxed primitives).
jobject arg(JNIEnv* env, jobjectArray args, int i);
/// Primitive values of boxed arguments, and boxed results.
double unboxNumber(JNIEnv* env, jobject boxed);
/// A boxed long, as it is (the glue makes it a bigint, or a group's number).
jlong unboxLong(JNIEnv* env, jobject boxed);
bool unboxBoolean(JNIEnv* env, jobject boxed);
jobject boxInt(JNIEnv* env, jint v);
jobject boxShort(JNIEnv* env, jshort v);
jobject boxByte(JNIEnv* env, jbyte v);
jobject boxChar(JNIEnv* env, jchar v);
jobject boxLong(JNIEnv* env, jlong v);
jobject boxDouble(JNIEnv* env, jdouble v);
jobject boxFloat(JNIEnv* env, jfloat v);
jobject boxBoolean(JNIEnv* env, bool v);

// --- Kotlin coroutines through generated shims ----------------------------------------

/// Throws `error` to Java as a java.lang.RuntimeException carrying its
/// message, which errorOf reads back as `error` itself.
void throwToJava(JNIEnv* env, Error error);

/**
 * A Lucent function a generated shim runs as a Kotlin suspend function (a
 * suspend function argument, a fun interface's suspending function), which
 * Kotlin waits for: `f` runs on the calling thread holding the Lucent lock
 * and gives the boxed result. What it throws is thrown to Kotlin (see
 * throwToJava), so the Kotlin call ends with that error.
 */
template <class F>
jobject callSuspending(JNIEnv* env, F f) {
  LucentScope scope;
  try {
    return f();
  } catch (...) {
    throwToJava(env, currentError(std::current_exception()));
    return nullptr;
  }
}

namespace detail {

/// A java.util.function.BiConsumer whose accept(value, error) calls
/// `settle`, where Java calls it. A local reference, new for each call.
jobject completionFor(JNIEnv* env, std::function<void(JNIEnv*, jobject value, jobject error)> settle);

}  // namespace detail

/**
 * A suspend function called through a generated Kotlin shim, as a promise
 * of the calling context. `start` calls the shim with a completion (a
 * BiConsumer of the value, or of the Throwable it threw) and returns what
 * cancels the coroutine (an AutoCloseable). `convert` reads the value,
 * where the coroutine completes. The signal aborting, or the context's
 * scope being disposed, rejects the promise and cancels the coroutine; a
 * value that arrives after that is released (nativeOperation).
 */
template <class T>
Promise<T> launch(Opt<AbortSignal> signal, const char* what, const std::function<jobject(JNIEnv*, jobject)>& start,
                  std::function<::lucent::detail::Stored<T>(JNIEnv*, jobject)> convert) {
  auto registration = [&start, convert = std::move(convert), what](const std::shared_ptr<Operation<T>>& op) -> std::function<void()> {
    JNIEnv* e = env();
    LocalFrame frame(e);
    std::weak_ptr<Operation<T>> pending = op;

    jobject done = detail::completionFor(e, [pending, convert](JNIEnv* e, jobject value, jobject error) {
      auto o = pending.lock();
      if (!o) return;

      if (error) {
        o->fail(errorOf(e, error));
        return;
      }

      try {
        if constexpr (std::is_void_v<T>) {
          o->succeed();
        } else {
          o->succeed(convert(e, value));
        }
      } catch (...) {
        o->fail(currentError(std::current_exception()));
      }
    });

    jobject cancel = start(e, done);
    check(e);

    NativeRef stop = wrap(e, cancel, what);
    return [stop] { close(stop); };
  };

  return nativeOperation<T>(registration, std::move(signal));
}

/// `appContext()` from lucent:android: the Application.
NativeRef appContext();

/// The context of the view hosting the mount whose setup runs now on this
/// thread (the Activity's, as React Native themes its views), or null
/// outside any setup.
Opt<NativeRef> hostContext();

/// The Context a view is made with: the hosting view's (its Activity's theme), else the app's.
inline NativeRef viewContext() {
  Opt<NativeRef> host = hostContext();
  return host.has() ? host.get() : appContext();
}

/**
 * While one lives, `view` (a local reference) hosts the mount whose setup
 * runs on this thread, and hostContext() is its context: the Android host
 * of components holds one around each setup. Nests.
 */
class HostViewEntry {
 public:
  explicit HostViewEntry(jobject view);
  ~HostViewEntry();

  HostViewEntry(const HostViewEntry&) = delete;
  HostViewEntry& operator=(const HostViewEntry&) = delete;

 private:
  jobject outer_;
};
/// `available("android", api)`.
bool available(double api);

// --- the app's Activities (platform/android_activity.cpp) ------------------------------

/// `currentActivity()` from lucent:android: the Activity in front (created,
/// started or resumed, and not destroyed), or null. Lucent holds Activities
/// weakly; the reference returned is one, for the caller's use now.
Opt<NativeRef> currentActivity();

/// `startActivityForResult(intent, signal)`: starts `intent` from the
/// Activity in front, through Lucent's request Activity, and resolves with
/// an android.app.Instrumentation.ActivityResult. Rejects with
/// ERR_NO_ACTIVITY without one; an aborted signal or the calling context's
/// root disposed cancels it, and a later answer is dropped.
Promise<NativeRef> startActivityForResult(const NativeRef& intent, Opt<AbortSignal> signal = {});

/// `requestPermissions(permissions, signal)`: whether each was granted, in
/// order. Requests run one at a time, as Android requires.
Promise<Array<bool>> requestPermissions(const Array<String>& permissions, Opt<AbortSignal> signal = {});

/// A lifecycle event's handler: the Activity, and the intent of a new intent.
using ActivityHandler = Fn<void(NativeRef, Opt<NativeRef>)>;

/// `onActivityEvent(event, handler)`: runs `handler` on the subscribing
/// context after each such event of the app's Activities ("created",
/// "started", "resumed", "paused", "stopped", "destroyed", "newIntent").
/// Returns the function that unsubscribes.
Fn<void()> onActivityEvent(const String& event, ActivityHandler handler);

}  // namespace lucent::jni
