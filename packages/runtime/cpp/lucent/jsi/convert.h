// Lucent runtime — conversions between JSI values and Lucent values.
//
// Values coming from JavaScript are validated against the declared Lucent
// type, because a JS caller can pass anything. Errors name the function and
// argument: "hash: argument 'input' must be a string".
//
// Arrays, records, maps and structs are copied across the boundary. Class
// instances keep their identity. All functions here run on the JS thread with
// the Lucent lock held.
#pragma once

#include <jsi/jsi.h>

#include <string>
#include <vector>

#include "../lucent.h"
#include "host.h"

namespace lucent::js {

/// Where a value sits, for error messages: "fn: argument 'a.b[2]'".
struct Path {
  const char* fn;
  std::string where;

  Path field(const char* name) const { return Path{fn, where + "." + name}; }
  Path index(size_t i) const { return Path{fn, where + "[" + std::to_string(i) + "]"}; }
  Path key(const std::string& k) const { return Path{fn, where + "[\"" + k + "\"]"}; }
};

[[noreturn]] void throwBoundaryError(jsi::Runtime& rt, const Path& path, const char* expected, const jsi::Value& actual);
const char* jsTypeName(jsi::Runtime& rt, const jsi::Value& v);

inline const jsi::Value& arg(const jsi::Value* args, size_t count, size_t i) {
  static const jsi::Value undef = jsi::Value::undefined();
  return i < count ? args[i] : undef;
}

template <class T, class Enable = void>
struct Convert;

// --- primitives ---------------------------------------------------------------

template <>
struct Convert<double> {
  static double fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isNumber()) throwBoundaryError(rt, p, "a number", v);
    return v.getNumber();
  }
  static jsi::Value toJs(jsi::Runtime&, Host&, double v) { return jsi::Value(v); }
};

template <>
struct Convert<bool> {
  static bool fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isBool()) throwBoundaryError(rt, p, "a boolean", v);
    return v.getBool();
  }
  static jsi::Value toJs(jsi::Runtime&, Host&, bool v) { return jsi::Value(v); }
};

String stringFromJs(jsi::Runtime& rt, const jsi::String& s);
jsi::String stringToJs(jsi::Runtime& rt, const String& s);

template <>
struct Convert<String> {
  static String fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isString()) throwBoundaryError(rt, p, "a string", v);
    return stringFromJs(rt, v.getString(rt));
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host&, const String& v) { return jsi::Value(rt, stringToJs(rt, v)); }
};

template <>
struct Convert<Undefined> {
  static Undefined fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isUndefined()) throwBoundaryError(rt, p, "undefined", v);
    return undefined;
  }
  static jsi::Value toJs(jsi::Runtime&, Host&, Undefined) { return jsi::Value::undefined(); }
};

template <>
struct Convert<Null> {
  static Null fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isNull()) throwBoundaryError(rt, p, "null", v);
    return null;
  }
  static jsi::Value toJs(jsi::Runtime&, Host&, Null) { return jsi::Value::null(); }
};

// --- optional -------------------------------------------------------------------

template <class T>
struct Convert<Opt<T>> {
  static Opt<T> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isUndefined()) return undefined;
    if (v.isNull()) return null;
    return Convert<T>::fromJs(rt, v, p);
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Opt<T>& v) {
    if (v.isUndefined()) return jsi::Value::undefined();
    if (v.isNull()) return jsi::Value::null();
    return Convert<T>::toJs(rt, h, v.get());
  }
};

// --- arrays -----------------------------------------------------------------------

template <class T>
struct Convert<Array<T>> {
  static Array<T> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !v.getObject(rt).isArray(rt)) throwBoundaryError(rt, p, "an array", v);
    jsi::Array a = v.getObject(rt).getArray(rt);
    size_t n = a.size(rt);
    std::vector<typename Array<T>::Elem> items;
    items.reserve(n);
    for (size_t i = 0; i < n; i++) {
      items.push_back(static_cast<typename Array<T>::Elem>(Convert<T>::fromJs(rt, a.getValueAtIndex(rt, i), p.index(i))));
    }
    return Array<T>(std::move(items));
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Array<T>& v) {
    const auto& items = v.items();
    jsi::Array a(rt, items.size());
    for (size_t i = 0; i < items.size(); i++) a.setValueAtIndex(rt, i, Convert<T>::toJs(rt, h, static_cast<T>(items[i])));
    return jsi::Value(rt, a);
  }
};

// --- tuples (JS arrays of fixed length) --------------------------------------------

template <class... Ts>
struct Convert<std::tuple<Ts...>> {
  static std::tuple<Ts...> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !v.getObject(rt).isArray(rt)) throwBoundaryError(rt, p, "an array", v);
    jsi::Array a = v.getObject(rt).getArray(rt);
    return read(rt, a, p, std::index_sequence_for<Ts...>{});
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const std::tuple<Ts...>& t) {
    jsi::Array a(rt, sizeof...(Ts));
    write(rt, h, a, t, std::index_sequence_for<Ts...>{});
    return jsi::Value(rt, a);
  }

 private:
  template <size_t... I>
  static std::tuple<Ts...> read(jsi::Runtime& rt, jsi::Array& a, const Path& p, std::index_sequence<I...>) {
    size_t n = a.size(rt);
    return std::tuple<Ts...>(Convert<Ts>::fromJs(rt, I < n ? a.getValueAtIndex(rt, I) : jsi::Value::undefined(), p.index(I))...);
  }
  template <size_t... I>
  static void write(jsi::Runtime& rt, Host& h, jsi::Array& a, const std::tuple<Ts...>& t, std::index_sequence<I...>) {
    (a.setValueAtIndex(rt, I, Convert<Ts>::toJs(rt, h, std::get<I>(t))), ...);
  }
};

// --- records (plain objects used as dictionaries) ----------------------------------

template <class V>
struct Convert<Dict<V>> {
  static Dict<V> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || v.getObject(rt).isArray(rt) || v.getObject(rt).isFunction(rt)) throwBoundaryError(rt, p, "an object", v);
    jsi::Object o = v.getObject(rt);
    jsi::Array names = o.getPropertyNames(rt);
    Dict<V> out;
    size_t n = names.size(rt);
    for (size_t i = 0; i < n; i++) {
      jsi::String key = names.getValueAtIndex(rt, i).getString(rt);
      std::string k = key.utf8(rt);
      out.set(stringFromJs(rt, key), Convert<V>::fromJs(rt, o.getProperty(rt, jsi::PropNameID::forString(rt, key)), p.key(k)));
    }
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Dict<V>& d) {
    jsi::Object o(rt);
    auto& t = d.table();
    for (size_t i = 0; i < t.slotCount(); i++) {
      if (!t.slotLive(i)) continue;
      o.setProperty(rt, jsi::PropNameID::forString(rt, stringToJs(rt, t.slot(i).key)), Convert<V>::toJs(rt, h, t.slot(i).value));
    }
    return jsi::Value(rt, o);
  }
};

// --- Map and Set -----------------------------------------------------------------------

bool isInstanceOf(jsi::Runtime& rt, const jsi::Object& o, const char* ctor);

template <class K, class V>
struct Convert<Map<K, V>> {
  static Map<K, V> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !isInstanceOf(rt, v.getObject(rt), "Map")) throwBoundaryError(rt, p, "a Map", v);
    jsi::Value entries = v.getObject(rt).getPropertyAsFunction(rt, "entries").callWithThis(rt, v.getObject(rt));
    jsi::Array list = rt.global().getPropertyAsObject(rt, "Array").getPropertyAsFunction(rt, "from").call(rt, entries).getObject(rt).getArray(rt);
    Map<K, V> out;
    size_t n = list.size(rt);
    for (size_t i = 0; i < n; i++) {
      jsi::Array pair = list.getValueAtIndex(rt, i).getObject(rt).getArray(rt);
      out.set(Convert<K>::fromJs(rt, pair.getValueAtIndex(rt, 0), p.index(i).field("key")),
              Convert<V>::fromJs(rt, pair.getValueAtIndex(rt, 1), p.index(i).field("value")));
    }
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Map<K, V>& m) {
    jsi::Object out = rt.global().getPropertyAsFunction(rt, "Map").callAsConstructor(rt).getObject(rt);
    jsi::Function set = out.getPropertyAsFunction(rt, "set");
    auto& t = m.table();
    for (size_t i = 0; i < t.slotCount(); i++) {
      if (!t.slotLive(i)) continue;
      set.callWithThis(rt, out, Convert<K>::toJs(rt, h, t.slot(i).key), Convert<V>::toJs(rt, h, t.slot(i).value));
    }
    return jsi::Value(rt, out);
  }
};

template <class T>
struct Convert<Set<T>> {
  static Set<T> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !isInstanceOf(rt, v.getObject(rt), "Set")) throwBoundaryError(rt, p, "a Set", v);
    jsi::Array list = rt.global().getPropertyAsObject(rt, "Array").getPropertyAsFunction(rt, "from").call(rt, v).getObject(rt).getArray(rt);
    Set<T> out;
    size_t n = list.size(rt);
    for (size_t i = 0; i < n; i++) out.add(Convert<T>::fromJs(rt, list.getValueAtIndex(rt, i), p.index(i)));
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Set<T>& s) {
    jsi::Object out = rt.global().getPropertyAsFunction(rt, "Set").callAsConstructor(rt).getObject(rt);
    jsi::Function add = out.getPropertyAsFunction(rt, "add");
    auto& t = s.table();
    for (size_t i = 0; i < t.slotCount(); i++) {
      if (t.slotLive(i)) add.callWithThis(rt, out, Convert<T>::toJs(rt, h, t.slot(i).key));
    }
    return jsi::Value(rt, out);
  }
};

// --- Uint8Array ------------------------------------------------------------------------

template <>
struct Convert<Bytes> {
  static Bytes fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Bytes& b);
};

// --- errors ------------------------------------------------------------------------------

template <>
struct Convert<Error> {
  static Error fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Error& e) { return h.errorToJs(rt, e); }
};

/// Dates cross as copies of their time value, like arrays.
template <>
struct Convert<Date> {
  static Date fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Date& d);
};

/// RegExps cross as their source and flags (JavaScript's lastIndex is not kept).
template <>
struct Convert<RegExp> {
  static RegExp fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isObject()) {
      jsi::Object o = v.getObject(rt);
      jsi::Value source = o.getProperty(rt, "source"), flags = o.getProperty(rt, "flags");
      if (source.isString() && flags.isString()) return makeRegExp(stringFromJs(rt, source.getString(rt)), stringFromJs(rt, flags.getString(rt)));
    }
    throwBoundaryError(rt, p, "a RegExp", v);
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host&, const RegExp& re) {
    return rt.global().getPropertyAsFunction(rt, "RegExp").callAsConstructor(rt, stringToJs(rt, re->source()), stringToJs(rt, re->flags()));
  }
};

/// A JavaScript iterable arrives as a snapshot (Array.from), iterated lazily.
template <class T>
struct Convert<Iter<T>> {
  static Iter<T> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() && !v.isString()) throwBoundaryError(rt, p, "an iterable", v);
    jsi::Function from = rt.global().getPropertyAsObject(rt, "Array").getPropertyAsFunction(rt, "from");
    return iterOf(Convert<Array<T>>::fromJs(rt, from.call(rt, v), p));
  }
};

/// An AbortSignal from JavaScript becomes a native signal that a listener on
/// the JS signal aborts. The native signal is cached on the JS object, so one
/// JS signal always maps to one native signal. Signals do not go the other way.
template <>
struct Convert<AbortSignal> {
  static AbortSignal fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
};

// --- promises ------------------------------------------------------------------------------

/// Hands a Lucent promise to JavaScript: the JS promise settles on the JS
/// thread when the Lucent one does.
template <class T>
struct Convert<Promise<T>> {
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Promise<T>& p) {
    uint64_t id = 0;
    jsi::Value jsPromise = h.createPromise(rt, id);
    std::weak_ptr<Host> weak = h.weak_from_this();
    p.onSettled([p, weak, id] {
      auto host = weak.lock();
      if (!host) return;
      host->postToJs([p, id, weak](jsi::Runtime& rt) {
        auto host = weak.lock();
        if (!host) return;
        LucentScope scope;
        if (p.fulfilled()) {
          jsi::Value value = jsi::Value::undefined();
          try {
            if constexpr (std::is_void_v<T>) {
              value = jsi::Value::undefined();
            } else {
              value = Convert<T>::toJs(rt, *host, p.value());
            }
          } catch (const jsi::JSError& e) {
            host->reject(rt, id, jsi::Value(rt, e.value()));
            return;
          }
          host->resolve(rt, id, value);
        } else {
          host->reject(rt, id, host->errorToJs(rt, p.error()));
        }
      });
    });
    return jsPromise;
  }
  /// A JS promise passed into Lucent (e.g. returned by a callback).
  static Promise<T> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
};

// --- functions -------------------------------------------------------------------------------

/// A JavaScript function held by Lucent. Calling it on the JS thread is a
/// normal synchronous call; from the Lucent thread the call is posted to the
/// JS thread (so it must return void or a Promise).
class JsCallback {
 public:
  JsCallback(Host& host, uint64_t id) : host_(host.weak_from_this()), id_(id) {}
  ~JsCallback() {
    if (auto h = host_.lock()) h->release(id_);
  }
  std::shared_ptr<Host> host() const { return host_.lock(); }
  uint64_t id() const { return id_; }

 private:
  std::weak_ptr<Host> host_;
  uint64_t id_;
};

template <class T>
struct IsPromiseType : std::false_type {};
template <class T>
struct IsPromiseType<Promise<T>> : std::true_type {};

template <class R, class... A>
struct Convert<Fn<R(A...)>> {
  static Fn<R(A...)> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !v.getObject(rt).isFunction(rt)) throwBoundaryError(rt, p, "a function", v);
    Host& host = Host::get(rt);
    auto cb = std::make_shared<JsCallback>(host, host.retain(rt, v.getObject(rt).getFunction(rt)));
    std::string where = std::string(p.fn) + " (callback " + p.where + ")";
    return Fn<R(A...)>([cb, where](A... args) -> R { return invoke(cb, where, std::move(args)...); });
  }

  static R invoke(const std::shared_ptr<JsCallback>& cb, const std::string& where, A... args) {
    auto host = cb->host();
    if (!host || !host->alive()) {
      if constexpr (std::is_void_v<R>) return;
      else throwError(String::fromLatin1("Error"), String::fromLatin1("The JavaScript runtime is gone"));
    }
    if (host->onJsThread()) {
      jsi::Runtime& rt = host->runtime();
      jsi::Function* fn = host->retained(cb->id());
      if (!fn) throwError(String::fromLatin1("Error"), String::fromLatin1("Callback was released"));
      jsi::Value result = jsi::Value::undefined();
      try {
        result = fn->call(rt, Convert<A>::toJs(rt, *host, args)...);
      } catch (const jsi::JSError& e) {
        throw Exception(Host::errorFromJs(rt, e));
      }
      if constexpr (std::is_void_v<R>) {
        return;
      } else {
        return Convert<R>::fromJs(rt, result, Path{where.c_str(), "return value"});
      }
    }
    if constexpr (std::is_void_v<R>) {
      std::weak_ptr<Host> weak = host;
      host->postToJs([cb, args...](jsi::Runtime& rt) mutable {
        auto host = cb->host();
        if (!host) return;
        jsi::Function* fn = host->retained(cb->id());
        if (!fn) return;
        LucentScope scope;
        try {
          fn->call(rt, Convert<A>::toJs(rt, *host, args)...);
        } catch (const jsi::JSError& e) {
          consoleWrite(ConsoleLevel::Error, String::fromUtf8("Uncaught error in callback: " + e.getMessage()));
        }
      });
      return;
    } else if constexpr (IsPromiseType<R>::value) {
      R out;
      host->postToJs([cb, out, where, args...](jsi::Runtime& rt) mutable {
        auto host = cb->host();
        jsi::Function* fn = host ? host->retained(cb->id()) : nullptr;
        LucentScope scope;
        if (!fn) {
          out.reject(makeError(String::fromLatin1("Callback was released")));
          return;
        }
        try {
          jsi::Value result = fn->call(rt, Convert<A>::toJs(rt, *host, args)...);
          R inner = Convert<R>::fromJs(rt, result, Path{where.c_str(), "return value"});
          inner.onSettled([inner, out] {
            if (inner.fulfilled()) {
              if constexpr (std::is_void_v<typename R::value_type>) out.resolve(undefined);
              else out.resolve(inner.value());
            } else {
              out.reject(inner.error());
            }
          });
        } catch (const jsi::JSError& e) {
          out.reject(Host::errorFromJs(rt, e));
        } catch (const Exception& e) {
          out.reject(e.error());
        }
      });
      return out;
    } else {
      throwError(String::fromLatin1("Error"),
                 String::fromUtf8(where + ": a callback that returns a value can only be called synchronously; make it return a Promise"));
    }
  }

  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Fn<R(A...)>& f) {
    std::weak_ptr<Host> weak = h.weak_from_this();
    return jsi::Function::createFromHostFunction(
        rt, jsi::PropNameID::forAscii(rt, "lucentFunction"), sizeof...(A),
        [f, weak](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
          auto host = weak.lock();
          if (!host) throw jsi::JSError(rt, "Lucent host is gone");
          LucentScope scope;
          try {
            return call(rt, *host, f, args, count, std::index_sequence_for<A...>{});
          } catch (const Exception& e) {
            throw jsi::JSError(rt, host->errorToJs(rt, e.error()));
          }
        });
  }

 private:
  template <size_t... I>
  static jsi::Value call(jsi::Runtime& rt, Host& h, const Fn<R(A...)>& f, const jsi::Value* args, size_t count, std::index_sequence<I...>) {
    static const jsi::Value undef = jsi::Value::undefined();
    Path p{"function", ""};
    if constexpr (std::is_void_v<R>) {
      f(Convert<std::decay_t<A>>::fromJs(rt, I < count ? args[I] : undef, Path{"function", "argument " + std::to_string(I)})...);
      return jsi::Value::undefined();
    } else {
      return Convert<R>::toJs(rt, h, f(Convert<std::decay_t<A>>::fromJs(rt, I < count ? args[I] : undef, Path{"function", "argument " + std::to_string(I)})...));
    }
  }
};

template <class T>
Promise<T> Convert<Promise<T>>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  Promise<T> out;
  if (!v.isObject() || !v.getObject(rt).getProperty(rt, "then").isObject()) {
    // Not a thenable: behaves like `await value`.
    if constexpr (std::is_void_v<T>) out.resolve(undefined);
    else out.resolve(Convert<T>::fromJs(rt, v, p));
    return out;
  }
  std::string where = std::string(p.fn) + " " + p.where;
  auto onFulfilled = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "onFulfilled"), 1,
      [out, where](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        LucentScope scope;
        try {
          if constexpr (std::is_void_v<T>) out.resolve(undefined);
          else out.resolve(Convert<T>::fromJs(rt, arg(args, count, 0), Path{where.c_str(), "resolved value"}));
        } catch (const jsi::JSError& e) {
          out.reject(Host::errorFromJs(rt, e));
        }
        return jsi::Value::undefined();
      });
  auto onRejected = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "onRejected"), 1,
      [out](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        LucentScope scope;
        out.reject(Convert<Error>::fromJs(rt, arg(args, count, 0), Path{"promise", "rejection"}));
        return jsi::Value::undefined();
      });
  jsi::Object promise = v.getObject(rt);
  promise.getPropertyAsFunction(rt, "then").callWithThis(rt, promise, onFulfilled, onRejected);
  return out;
}

// --- helpers used by generated bindings ----------------------------------------------------


/// Runs a synchronous Lucent call from JS, translating Lucent errors into
/// JS exceptions.
template <class F>
jsi::Value callSync(jsi::Runtime& rt, Host& host, F&& body) {
  LucentScope scope;
  try {
    return body();
  } catch (const Exception& e) {
    throw jsi::JSError(rt, host.errorToJs(rt, e.error()));
  } catch (const jsi::JSError&) {
    throw;
  } catch (const jsi::JSIException&) {
    throw;
  } catch (const std::exception& e) {
    throw jsi::JSError(rt, host.errorToJs(rt, currentError(std::current_exception())));
  }
}

/// Starts an exported async function on the Lucent thread and returns a JS
/// promise for its result. `start` runs on the Lucent thread and returns the
/// Lucent promise.
template <class T, class F>
jsi::Value callAsync(jsi::Runtime& rt, Host& host, F&& start) {
  uint64_t id = 0;
  jsi::Value jsPromise = host.createPromise(rt, id);
  std::weak_ptr<Host> weak = host.weak_from_this();
  Scheduler::instance().post([weak, id, start = std::forward<F>(start)]() mutable {
    Promise<T> p;
    try {
      p = start();
    } catch (...) {
      p = Promise<T>::rejected(currentError(std::current_exception()));
    }
    p.onSettled([p, weak, id] {
      auto host = weak.lock();
      if (!host) return;
      host->postToJs([p, id, weak](jsi::Runtime& rt) {
        auto host = weak.lock();
        if (!host) return;
        LucentScope scope;
        if (p.fulfilled()) {
          jsi::Value value = jsi::Value::undefined();
          if constexpr (!std::is_void_v<T>) {
            try {
              value = Convert<T>::toJs(rt, *host, p.value());
            } catch (const jsi::JSError& e) {
              host->reject(rt, id, jsi::Value(rt, e.value()));
              return;
            }
          }
          host->resolve(rt, id, value);
        } else {
          host->reject(rt, id, host->errorToJs(rt, p.error()));
        }
      });
    });
  });
  return jsPromise;
}

}  // namespace lucent::js
