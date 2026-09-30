// Lucent runtime — a component's Compose content (lucent:compose), for the
// generated glue of *.android.lucent.tsx components.
//
// The content's body is generated Kotlin: a composable reading a state
// holder (`<registration>State`), and a host object (`<registration>Host`)
// that gives it to the runtime's host of Compose content
// (dev.lucent.compose.LucentComposition), which makes the ComposeView
// showing it with the context of the view hosting the mount. The
// component's setup, in C++, writes the holder: an effect per value the
// body reads (a prop, a signal, a value computed by setup code) sets its
// Compose state, and each setup function the body calls (an action) is a
// Kotlin function object whose calls enter the main context. Everything
// here runs on the main thread, in the main context.
#pragma once

#include <jni.h>

#include <initializer_list>
#include <memory>
#include <string>
#include <type_traits>
#include <utility>

#include "../array.h"
#include "../execution.h"
#include "../function.h"
#include "../items.h"
#include "android.h"

namespace lucent::compose {

namespace detail {

/// The runtime's host of Compose content (runtime/native/android/src/compose), and how a host object makes one.
constexpr const char* kComposition = "dev/lucent/compose/LucentComposition";
constexpr const char* kCreate = "(Landroid/content/Context;Ljava/lang/Object;)Ldev/lucent/compose/LucentComposition;";

inline jobject box(JNIEnv* e, double v) { return jni::boxDouble(e, v); }
inline jobject box(JNIEnv* e, bool v) { return jni::boxBoolean(e, v); }
inline jobject box(JNIEnv* e, const String& v) { return jni::toJString(e, v); }

template <class T>
jobject box(JNIEnv* e, const Opt<T>& v) {
  return v.has() ? box(e, v.get()) : nullptr;
}

/// A Kotlin function's argument (boxed), as the Lucent function takes it.
template <class T>
struct Unbox;

template <>
struct Unbox<double> {
  static double from(JNIEnv* e, jobject o) { return jni::unboxNumber(e, o); }
};

template <>
struct Unbox<bool> {
  static bool from(JNIEnv* e, jobject o) { return jni::unboxBoolean(e, o); }
};

template <>
struct Unbox<String> {
  static String from(JNIEnv* e, jobject o) { return jni::fromJString(e, static_cast<jstring>(o), "a Compose argument"); }
};

template <class T>
struct Unbox<Opt<T>> {
  static Opt<T> from(JNIEnv* e, jobject o) { return o ? Opt<T>(Unbox<T>::from(e, o)) : Opt<T>(null); }
};

/// `invoke(Ljava/lang/Object;…)`: how NativeProxy keys a FunctionN's method.
template <size_t N>
const char* invokeKey() {
  static const std::string key = [] {
    std::string k = "invoke(";
    for (size_t i = 0; i < N; i++) k += "Ljava/lang/Object;";
    return k + ")";
  }();
  return key.c_str();
}

}  // namespace detail

// --- plain data, encoded for the Kotlin side (emit/toolkit-values.ts) -----------------------
//
// Each returns a local reference; the Holder's setters free them.

inline jobject value(double v) { return jni::boxDouble(jni::env(), v); }
inline jobject value(bool v) { return jni::boxBoolean(jni::env(), v); }
inline jobject value(const String& v) { return jni::toJString(jni::env(), v); }

/// null when `v` is null or undefined, else `each` of its value.
template <class T, class F>
jobject optional(const Opt<T>& v, F each) {
  return v.has() ? each(v.get()) : nullptr;
}

/// An Object[] of `each` of the elements.
template <class T, class F>
jobject array(const Array<T>& a, F each) {
  return jni::toObjectArray(jni::env(), a, "java/lang/Object", each);
}

/// An object's fields, in order: an Object[] taking the references.
inline jobject record(std::initializer_list<jobject> fields) {
  JNIEnv* e = jni::env();
  jobjectArray out = e->NewObjectArray(static_cast<jsize>(fields.size()), jni::findClass("java/lang/Object"), nullptr);
  jsize i = 0;

  for (jobject f : fields) {
    e->SetObjectArrayElement(out, i++, f);
    if (f) e->DeleteLocalRef(f);
  }

  return out;
}

/**
 * One mount's content: its Kotlin state holder, and the ComposeView once
 * made. Copies share it. Made, written and disposed on the main context.
 */
class Holder {
 public:
  /// A new holder of `stateClass`, shown by `hostClass` (JNI class names).
  static Holder create(const char* stateClass, const char* hostClass) {
    JNIEnv* e = jni::env();
    jni::LocalFrame frame(e);
    jclass cls = jni::findClass(stateClass);
    jobject state = e->NewObject(cls, jni::method(cls, "<init>", "()V"));
    jni::check(e);

    Holder h;
    jmethodID set = jni::method(cls, "set", "(ILjava/lang/Object;)V");
    jmethodID setAction = jni::method(cls, "setAction", "(ILjava/lang/Object;)V");
    jmethodID listSetter = jni::method(cls, "setList", "(ILjava/lang/Object;)V");
    h.s_ = std::make_shared<Shared>(Shared{jni::wrap(e, state, stateClass), set, setAction, listSetter, {}, {}, hostClass});
    return h;
  }

  /// Sets the Compose state `slot` holds: the body recomposes where it reads it.
  template <class T>
    requires(!std::is_invocable_v<T>)
  void set(int slot, const T& value) const {
    JNIEnv* e = jni::env();
    jni::LocalFrame frame(e);
    call(e, s_->set, slot, detail::box(e, value));
  }

  /// Sets it to what `encode` makes (a local reference, freed here): encoded plain data.
  template <class F>
    requires std::is_invocable_r_v<jobject, F>
  void set(int slot, F encode) const {
    JNIEnv* e = jni::env();
    jni::LocalFrame frame(e);
    call(e, s_->set, slot, encode());
  }

  /**
   * Sets list `slot` to the records `encode` makes (a local reference,
   * freed here): the body merges them into its items by key.
   */
  template <class F>
  void setList(int slot, F encode) const {
    JNIEnv* e = jni::env();
    jni::LocalFrame frame(e);
    call(e, s_->listSetter, slot, encode());
  }

  /**
   * Gives the body `f` as the Kotlin function action `slot` holds (a
   * kotlin.jvm.functions.FunctionN): a call from Compose (a click) runs it
   * now, in the main context, and what it throws is reported.
   */
  template <class... A>
  void setAction(int slot, Fn<void(A...)> f, const char* site) const {
    JNIEnv* e = jni::env();
    jni::LocalFrame frame(e);
    std::string iface = "kotlin/jvm/functions/Function" + std::to_string(sizeof...(A));
    const void* identity = f.identity();
    jobject fn = jni::proxyFor(
        e, iface.c_str(), identity,
        {{detail::invokeKey<sizeof...(A)>(),
          [f = std::move(f)](JNIEnv* env, jobjectArray args) -> jobject {
            callNowIn(ExecutionContext::main(), [&] { invoke(env, f, args, std::index_sequence_for<A...>{}); });
            return nullptr;
          }}},
        site);
    call(e, s_->setAction, slot, fn);
  }

  /**
   * The ComposeView showing the content, made once, with the context of
   * the view hosting the mount: setup calls it (the value of compose()).
   */
  NativeRef content() const {
    if (s_->view) return s_->view;

    auto context = jni::hostContext();

    if (!context.has())
      throwError(String::fromLatin1("Error"), String::fromLatin1("compose() runs only in a component's setup"));

    JNIEnv* e = jni::env();
    jni::LocalFrame frame(e);
    jclass host = jni::findClass(s_->host);
    jmethodID create = jni::staticMethod(host, "create", detail::kCreate);
    jobject composition = e->CallStaticObjectMethod(host, create, jni::unwrap(context), jni::unwrap(s_->state));
    jni::check(e);

    static jmethodID getView =
        jni::method(jni::findClass(detail::kComposition), "getView", "()Landroid/view/View;");
    jobject view = e->CallObjectMethod(composition, getView);
    jni::check(e);

    s_->composition = jni::wrap(e, composition, "the host of a component's Compose content");
    s_->view = jni::wrap(e, view, "a ComposeView");
    return s_->view;
  }

  /// The mount went: its composition ends, or never starts; the view is not shown again.
  void dispose() const {
    if (!s_->composition) return;

    JNIEnv* e = jni::env();
    static jmethodID end = jni::method(jni::findClass(detail::kComposition), "dispose", "()V");

    e->CallVoidMethod(jni::unwrap(s_->composition), end);
    jni::check(e);
  }

 private:
  struct Shared {
    NativeRef state;
    jmethodID set;
    jmethodID setAction;
    jmethodID listSetter;
    /// Once made: the runtime's host of the content, and its view.
    NativeRef composition;
    NativeRef view;
    const char* host;
  };

  std::shared_ptr<Shared> s_;

  void call(JNIEnv* e, jmethodID setter, int slot, jobject value) const {
    e->CallVoidMethod(jni::unwrap(s_->state), setter, static_cast<jint>(slot), value);
    jni::check(e);
  }

  template <class... A, size_t... I>
  static void invoke(JNIEnv* e, const Fn<void(A...)>& f, jobjectArray args, std::index_sequence<I...>) {
    f(detail::Unbox<A>::from(e, jni::arg(e, args, static_cast<int>(I)))...);
  }
};

}  // namespace lucent::compose
