// Lucent runtime — conversions between JSI values and Lucent values.
//
// Values coming from JavaScript are validated against the declared Lucent
// type, because a JS caller can pass anything. Errors name the function and
// argument: "hash: argument 'input' must be a string".
//
// Arrays, records, maps and structs are copied across the boundary. Class
// instances keep their identity. All functions here run on the JS thread,
// holding the actor of the module called (callSync, host.h).
#pragma once

#include <array>

#include <jsi/jsi.h>

#include <optional>
#include <string>
#include <tuple>
#include <typeinfo>
#include <vector>

#include "../lucent.h"
#include "../trace.h"
#include "host.h"

namespace lucent::js {

class Site;

/// Where a value sits in what JavaScript passed, for error messages:
/// `sumPoints: argument 'ps'[3].x`. Each step points at its parent on the
/// stack and is rendered only when a conversion fails, so converting a large
/// array allocates nothing for paths.
struct Path {
  /// The function: "sumPoints". It and `root` are literals or outlive the
  /// conversion (a callback's site, which it keeps).
  const char* fn;
  /// The root: "argument 'ps'", "this", "resolved value"; with `Step::Argument`,
  /// "argument " followed by `idx` (a rest parameter's elements).
  const char* root = "";
  const Path* parent = nullptr;
  enum class Step : unsigned char { Root, Argument, Field, Index, Key } step = Step::Root;
  const char* name = nullptr;
  size_t idx = 0;
  /// A record's key, read as UTF-8 only when the path is rendered.
  jsi::Runtime* rt = nullptr;
  const jsi::String* keyName = nullptr;
  /// In place of `fn`, a callback's or a promise's site (see Site).
  const Site* site = nullptr;

  /// What a value from the callback or promise `site` converts at: its `root`.
  static Path at(const Site& site, const char* root) {
    Path p{"", root};
    p.site = &site;
    return p;
  }
  /// The function, as an error names it.
  std::string function() const;

  /// `argument <n>`, the number rendered only for an error.
  static Path argument(const char* fn, size_t n) {
    Path p{fn, "argument "};
    p.step = Step::Argument;
    p.idx = n;
    return p;
  }
  Path field(const char* n) const {
    Path p{fn, "", this, Step::Field};
    p.site = site;
    p.name = n;
    return p;
  }
  Path index(size_t i) const {
    Path p{fn, "", this, Step::Index};
    p.site = site;
    p.idx = i;
    return p;
  }
  Path key(jsi::Runtime& runtime, const jsi::String& k) const {
    Path p{fn, "", this, Step::Key};
    p.site = site;
    p.rt = &runtime;
    p.keyName = &k;
    return p;
  }
  /// `argument 'ps'[3].x`
  std::string where() const {
    switch (step) {
      case Step::Root: return root;
      case Step::Argument: return root + std::to_string(idx);
      case Step::Field: return parent->where() + "." + name;
      case Step::Index: return parent->where() + "[" + std::to_string(idx) + "]";
      case Step::Key: return parent->where() + "[\"" + keyName->utf8(*rt) + "\"]";
    }
    return root;
  }
};

/// Where a callback or a promise JavaScript gave was converted, rendered
/// (`fn (callback argument 'f')`) only when an error needs it: a call that
/// passes a function allocates no message.
class Site {
 public:
  Site(const Path& p, const char* prefix, const char* suffix) : fn_(p.fn), prefix_(prefix), suffix_(suffix) {
    // A path's steps live on the converting call's stack, and a site's own text in its owner:
    // a root (a literal) is kept as it is; anything else, rendered now.
    if (p.step == Path::Step::Root && !p.site) root_ = p.root;
    else where_ = p.where();
    if (p.site) outer_ = p.site->text();
  }
  /// `sumMapped (callback argument 'f')`
  std::string text() const {
    return (outer_.empty() ? std::string(fn_) : outer_) + prefix_ + (root_ ? std::string(root_) : where_) + suffix_;
  }

 private:
  const char* fn_;
  const char* prefix_;
  const char* suffix_;
  const char* root_ = nullptr;
  std::string where_;
  std::string outer_;
};

inline std::string Path::function() const { return site ? site->text() : std::string(fn); }

[[noreturn]] void throwBoundaryError(jsi::Runtime& rt, const Path& path, const char* expected, const jsi::Value& actual);
/// A union's discriminant `got` (at `path`) names none of its members, `accepted`
/// being their values: `"circle" or "square"`.
[[noreturn]] void throwUnknownDiscriminant(jsi::Runtime& rt, const Path& path, const char* accepted, const jsi::Value& got);
const char* jsTypeName(jsi::Runtime& rt, const jsi::Value& v);

inline const jsi::Value& arg(const jsi::Value* args, size_t count, size_t i) {
  static const jsi::Value undef = jsi::Value::undefined();
  return i < count ? args[i] : undef;
}

template <class T, class Enable = void>
struct Convert;

// --- boundary spellings ------------------------------------------------------------

/// A string literal as a template argument: what a boundary error says a
/// value must be.
template <size_t N>
struct Text {
  constexpr Text(const char (&s)[N]) { std::copy_n(s, N, chars); }
  char chars[N];
};

/// TypeScript's `T | undefined` and `T | null`, spelled for the boundary
/// only: each converts to `Opt<T>` as Convert<Opt<T>> does, but admits only
/// its own absent value, failing the other with `Expected`. Generated code
/// spells a value's type with them wherever such an optional sits (an
/// array's elements, a callback's result, a promise's value…); Lucent
/// values never have these types (ValueOf).
template <class T, Text Expected>
struct OrUndefined;
template <class T, Text Expected>
struct OrNull;

/// The Lucent value a boundary spelling converts to: the spelling itself,
/// but for OrUndefined and OrNull, which are Opt, and the containers of them.
template <class S>
struct ValueOfSpec {
  using type = S;
};
template <class S>
using ValueOf = typename ValueOfSpec<S>::type;

template <class T, Text E>
struct ValueOfSpec<OrUndefined<T, E>> {
  using type = Opt<ValueOf<T>>;
};
template <class T, Text E>
struct ValueOfSpec<OrNull<T, E>> {
  using type = Opt<ValueOf<T>>;
};
template <class T>
struct ValueOfSpec<Opt<T>> {
  using type = Opt<ValueOf<T>>;
};
template <class T>
struct ValueOfSpec<Array<T>> {
  using type = Array<ValueOf<T>>;
};
template <class... Ts>
struct ValueOfSpec<std::tuple<Ts...>> {
  using type = std::tuple<ValueOf<Ts>...>;
};
template <class V>
struct ValueOfSpec<Dict<V>> {
  using type = Dict<ValueOf<V>>;
};
template <class K, class V>
struct ValueOfSpec<Map<K, V>> {
  using type = Map<ValueOf<K>, ValueOf<V>>;
};
template <class T>
struct ValueOfSpec<Set<T>> {
  using type = Set<ValueOf<T>>;
};
template <class T>
struct ValueOfSpec<Iter<T>> {
  using type = Iter<ValueOf<T>>;
};
template <class T>
struct ValueOfSpec<Promise<T>> {
  using type = Promise<ValueOf<T>>;
};
template <class R, class... A>
struct ValueOfSpec<Fn<R(A...)>> {
  using type = Fn<ValueOf<R>(ValueOf<A>...)>;
};

/// Conversions that also take an object the caller owns (generated structs):
/// an array element is moved into one instead of its handle being cloned.
template <class T>
concept ConvertsFromObject = requires(jsi::Runtime& rt, const jsi::Object& o, const Path& p) { Convert<T>::fromObject(rt, o, p); };

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
  static jsi::Value toJs(jsi::Runtime& rt, Host&, const String& v) { return jsi::Value(stringToJs(rt, v)); }
};

/// Bigints cross exactly: through jsi::BigInt's 64-bit forms when the value
/// fits (no string, no allocation on the Lucent side), else through its
/// digits, and the JS side's global BigInt for the value it gets.
template <>
struct Convert<BigInt> {
  static BigInt fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const BigInt& v);
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
  using V = Opt<ValueOf<T>>;

  static V fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isUndefined()) return undefined;
    if (v.isNull()) return null;
    return Convert<T>::fromJs(rt, v, p);
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const V& v) {
    if (v.isUndefined()) return jsi::Value::undefined();
    if (v.isNull()) return jsi::Value::null();
    return Convert<T>::toJs(rt, h, v.get());
  }
  /// A value no Lucent code holds any more (a function's result): its
  /// value is handed on as such, so bytes can move instead of copying.
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, V&& v) {
    if (v.isUndefined()) return jsi::Value::undefined();
    if (v.isNull()) return jsi::Value::null();
    return Convert<T>::toJs(rt, h, std::move(v.get()));
  }
};

/// `T | undefined` inside a container: null fails with `E`.
template <class T, Text E>
struct Convert<OrUndefined<T, E>> : Convert<Opt<T>> {
  static Opt<ValueOf<T>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isNull()) throwBoundaryError(rt, p, E.chars, v);
    return Convert<Opt<T>>::fromJs(rt, v, p);
  }
};

/// `T | null` inside a container: undefined fails with `E`.
template <class T, Text E>
struct Convert<OrNull<T, E>> : Convert<Opt<T>> {
  static Opt<ValueOf<T>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isUndefined()) throwBoundaryError(rt, p, E.chars, v);
    return Convert<Opt<T>>::fromJs(rt, v, p);
  }
};

/// An optional TypeScript admits one absent value of: `undefined` (`x?: T`,
/// `T | undefined`) or, when `admitsNull`, `null` (`T | null`). The other one
/// fails with `expected`, where Convert<Opt<T>> would take both.
template <class T>
Opt<ValueOf<T>> optionalFromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p, bool admitsNull, const char* expected) {
  using V = Opt<ValueOf<T>>;
  if (v.isUndefined() || v.isNull()) {
    // A JSValue admits JavaScript's every value: either absent one is absent, as `??` sees it.
    if constexpr (!std::is_same_v<T, JSValue>)
      if (v.isNull() != admitsNull) throwBoundaryError(rt, p, expected, v);
    return v.isNull() ? V(null) : V(undefined);
  }
  return Convert<T>::fromJs(rt, v, p);
}

// --- arrays -----------------------------------------------------------------------

template <class T>
struct Convert<Array<T>> {
  using E = ValueOf<T>;

  static Array<E> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !v.getObject(rt).isArray(rt)) throwBoundaryError(rt, p, "an array", v);
    jsi::Array a = v.getObject(rt).getArray(rt);
    size_t n = a.size(rt);
    std::vector<typename Array<E>::Elem> items;
    items.reserve(n);
    for (size_t i = 0; i < n; i++) {
      if constexpr (ConvertsFromObject<T>) {
        jsi::Value e = a.getValueAtIndex(rt, i);
        if (!e.isObject()) throwBoundaryError(rt, p.index(i), "an object", e);
        items.push_back(static_cast<typename Array<E>::Elem>(Convert<T>::fromObject(rt, std::move(e).getObject(rt), p.index(i))));
      } else {
        items.push_back(static_cast<typename Array<E>::Elem>(Convert<T>::fromJs(rt, a.getValueAtIndex(rt, i), p.index(i))));
      }
    }
    return Array<E>(std::move(items));
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Array<E>& v) {
    const auto& items = v.items();
    jsi::Array a(rt, items.size());
    for (size_t i = 0; i < items.size(); i++) a.setValueAtIndex(rt, i, Convert<T>::toJs(rt, h, static_cast<E>(items[i])));
    return jsi::Value(std::move(a));
  }
};

// --- tuples (JS arrays of fixed length) --------------------------------------------

template <class... Ts>
struct Convert<std::tuple<Ts...>> {
  using V = std::tuple<ValueOf<Ts>...>;

  static V fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !v.getObject(rt).isArray(rt)) throwBoundaryError(rt, p, "an array", v);
    jsi::Array a = v.getObject(rt).getArray(rt);
    return read(rt, a, p, std::index_sequence_for<Ts...>{});
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const V& t) {
    jsi::Array a(rt, sizeof...(Ts));
    write(rt, h, a, t, std::index_sequence_for<Ts...>{});
    return jsi::Value(std::move(a));
  }

 private:
  template <size_t... I>
  static V read(jsi::Runtime& rt, jsi::Array& a, const Path& p, std::index_sequence<I...>) {
    size_t n = a.size(rt);
    return V(Convert<Ts>::fromJs(rt, I < n ? a.getValueAtIndex(rt, I) : jsi::Value::undefined(), p.index(I))...);
  }
  template <size_t... I>
  static void write(jsi::Runtime& rt, Host& h, jsi::Array& a, const V& t, std::index_sequence<I...>) {
    (a.setValueAtIndex(rt, I, Convert<Ts>::toJs(rt, h, std::get<I>(t))), ...);
  }
};

// --- records (plain objects used as dictionaries) ----------------------------------

template <class V>
struct Convert<Dict<V>> {
  static Dict<ValueOf<V>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || v.getObject(rt).isArray(rt) || v.getObject(rt).isFunction(rt)) throwBoundaryError(rt, p, "an object", v);
    jsi::Object o = v.getObject(rt);
    jsi::Array names = o.getPropertyNames(rt);
    Dict<ValueOf<V>> out;
    size_t n = names.size(rt);
    for (size_t i = 0; i < n; i++) {
      jsi::String key = names.getValueAtIndex(rt, i).getString(rt);
      out.set(stringFromJs(rt, key), Convert<V>::fromJs(rt, o.getProperty(rt, jsi::PropNameID::forString(rt, key)), p.key(rt, key)));
    }
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Dict<ValueOf<V>>& d) {
    jsi::Object o(rt);
    auto& t = d.table();
    for (size_t i = 0; i < t.slotCount(); i++) {
      if (!t.slotLive(i)) continue;
      o.setProperty(rt, jsi::PropNameID::forString(rt, stringToJs(rt, t.slot(i).key)), Convert<V>::toJs(rt, h, t.slot(i).value));
    }
    return jsi::Value(std::move(o));
  }
};

// --- Map and Set -----------------------------------------------------------------------

bool isInstanceOf(jsi::Runtime& rt, const jsi::Object& o, const char* ctor);

template <class K, class V>
struct Convert<Map<K, V>> {
  static Map<ValueOf<K>, ValueOf<V>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !isInstanceOf(rt, v.getObject(rt), "Map")) throwBoundaryError(rt, p, "a Map", v);
    jsi::Value entries = v.getObject(rt).getPropertyAsFunction(rt, "entries").callWithThis(rt, v.getObject(rt));
    jsi::Array list = rt.global().getPropertyAsObject(rt, "Array").getPropertyAsFunction(rt, "from").call(rt, entries).getObject(rt).getArray(rt);
    Map<ValueOf<K>, ValueOf<V>> out;
    size_t n = list.size(rt);
    for (size_t i = 0; i < n; i++) {
      jsi::Array pair = list.getValueAtIndex(rt, i).getObject(rt).getArray(rt);
      out.set(Convert<K>::fromJs(rt, pair.getValueAtIndex(rt, 0), p.index(i).field("key")),
              Convert<V>::fromJs(rt, pair.getValueAtIndex(rt, 1), p.index(i).field("value")));
    }
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Map<ValueOf<K>, ValueOf<V>>& m) {
    jsi::Object out = rt.global().getPropertyAsFunction(rt, "Map").callAsConstructor(rt).getObject(rt);
    jsi::Function set = out.getPropertyAsFunction(rt, "set");
    auto& t = m.table();
    for (size_t i = 0; i < t.slotCount(); i++) {
      if (!t.slotLive(i)) continue;
      set.callWithThis(rt, out, Convert<K>::toJs(rt, h, t.slot(i).key), Convert<V>::toJs(rt, h, t.slot(i).value));
    }
    return jsi::Value(std::move(out));
  }
};

template <class T>
struct Convert<Set<T>> {
  static Set<ValueOf<T>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !isInstanceOf(rt, v.getObject(rt), "Set")) throwBoundaryError(rt, p, "a Set", v);
    jsi::Array list = rt.global().getPropertyAsObject(rt, "Array").getPropertyAsFunction(rt, "from").call(rt, v).getObject(rt).getArray(rt);
    Set<ValueOf<T>> out;
    size_t n = list.size(rt);
    for (size_t i = 0; i < n; i++) out.add(Convert<T>::fromJs(rt, list.getValueAtIndex(rt, i), p.index(i)));
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Set<ValueOf<T>>& s) {
    jsi::Object out = rt.global().getPropertyAsFunction(rt, "Set").callAsConstructor(rt).getObject(rt);
    jsi::Function add = out.getPropertyAsFunction(rt, "add");
    auto& t = s.table();
    for (size_t i = 0; i < t.slotCount(); i++) {
      if (t.slotLive(i)) add.callWithThis(rt, out, Convert<T>::toJs(rt, h, t.slot(i).key));
    }
    return jsi::Value(std::move(out));
  }
};

// --- Uint8Array ------------------------------------------------------------------------

/// A synchronous call's byte argument read in place, which the compiler
/// lends when the function only reads it while it runs: JavaScript's own
/// bytes (only a view's, for part of a buffer), uncopied. Should anything
/// still hold them when the call ends, they become a copy then, so nothing
/// outlives the memory JavaScript lent. Pass `get()` on; keep the
/// Borrowed itself until the call returns.
template <class T>
class Borrowed {
 public:
  explicit Borrowed(T value) : value_(std::move(value)) {}
  Borrowed(Borrowed&&) = default;
  Borrowed(const Borrowed&) = delete;
  Borrowed& operator=(const Borrowed&) = delete;
  Borrowed& operator=(Borrowed&&) = delete;
  ~Borrowed() {
    const Storage& s = storageOf(value_);
    if (s && s.use_count() > 1) s->keep();
  }

  const T& get() const { return value_; }

 private:
  static const Storage& storageOf(const ArrayBuffer& b) { return b.storage(); }
  template <class K>
  static const Storage& storageOf(const TypedArray<K>& b) {
    return b.buffer();
  }

  T value_;
};

template <>
struct Convert<Bytes> {
  static Bytes fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  /// The view's bytes in place, for one synchronous call (see Borrowed).
  static Borrowed<Bytes> borrow(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Bytes& b);
  /// A function's result: when nothing else holds its buffer and it views
  /// the whole of it, JavaScript's Uint8Array is over the same bytes.
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, Bytes&& b);
};

/// An ArrayBuffer crosses as a copy, as a Uint8Array does. One a function
/// returns that nothing else holds (no variable, field or view) moves
/// instead: the copy would be the only one, so JavaScript's ArrayBuffer is
/// over the same bytes, adopted ones included.
template <>
struct Convert<ArrayBuffer> {
  static ArrayBuffer fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  /// The buffer's bytes in place, for one synchronous call (see Borrowed).
  static Borrowed<ArrayBuffer> borrow(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const ArrayBuffer& b);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, ArrayBuffer&& b);
};

// --- the other typed arrays, and DataView ---------------------------------------------------

/// The elements a JavaScript `name` (a typed array's class) views, each
/// `element` bytes long: where they start, and how many there are.
std::pair<uint8_t*, size_t> typedView(jsi::Runtime& rt, const jsi::Value& v, const Path& p, const char* name, size_t element);
/// A new JavaScript `name` over a copy of the `size` bytes at `data`.
jsi::Value typedCopy(jsi::Runtime& rt, const char* name, const uint8_t* data, size_t size);
/// A new JavaScript `name` over `storage`, which no Lucent code holds from now on.
jsi::Value typedMoved(jsi::Runtime& rt, const char* name, Storage storage);

/// A typed array crosses as Uint8Array does: a copy, lent to a synchronous
/// call that only reads it, moved when a function returns one nothing else
/// holds that views the whole of its buffer.
template <class K>
struct Convert<TypedArray<K>> {
  using A = TypedArray<K>;

  static A fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    auto [data, n] = typedView(rt, v, p, K::name, A::kElement);
    A out(static_cast<double>(n));
    if (n) std::memcpy(out.data(), data, n * A::kElement);
    return out;
  }
  static Borrowed<A> borrow(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    auto [data, n] = typedView(rt, v, p, K::name, A::kElement);
    return Borrowed<A>(A::view(ByteStorage::lend(data, n * A::kElement), 0, n));
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host&, const A& a) {
    return typedCopy(rt, K::name, a.data(), a.size() * A::kElement);
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, A&& a) {
    bool whole = a.offset() == 0 && a.size() * A::kElement == a.buffer()->size();
    if (!whole || a.buffer().use_count() != 1 || a.buffer()->lent()) return toJs(rt, h, static_cast<const A&>(a));
    return typedMoved(rt, K::name, a.buffer());
  }
};

/// A DataView crosses as a copy of the bytes it views, in a buffer of their own.
template <>
struct Convert<DataView> {
  static DataView fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const DataView& d);
};

// --- native buffers ------------------------------------------------------------------------

/// A NativeBuffer crosses as an opaque handle, the same JS object for the
/// same buffer while JavaScript holds it. Its methods mirror lucent:core's:
/// `byteLength`, `toUint8Array()`, `withRead(f)` and `withWrite(f)` (with
/// `withReadAs` and `withWriteAs`, another typed array), `transfer()`,
/// `transferToArrayBuffer()`, `close()` (and Symbol.dispose) and `handle()`.
/// A borrow lends JavaScript a copy (a write borrow copies it back when the
/// callback returns), counted in the buffer stats. Only
/// transferToArrayBuffer() gives it an ArrayBuffer over the storage, which
/// then no Lucent code holds.
template <>
struct Convert<NativeBuffer> {
  static NativeBuffer fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const NativeBuffer& b);
};

/// A NativeHandle crosses as an opaque handle too, the same JS object for
/// the same handle: `pointer` (a bigint, 0n once released), `released` and
/// `release()`. One JavaScript drops unreleased is released when it is
/// collected, which a debug build counts (Host::Ownership::releasedOpen).
template <>
struct Convert<NativeHandle> {
  static NativeHandle fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const NativeHandle& handle);
};

// --- errors ------------------------------------------------------------------------------

/// The cause of the JavaScript error `error`, as a Lucent Error, its causes
/// too, so far down: empty when it has none, or one that isn't an Error.
Error causeFromJs(jsi::Runtime& rt, const jsi::Object& error);

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
  static Iter<ValueOf<T>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
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

/// A component's ref (its host view, decision 0105), as lucent:ui's
/// ComponentView: the mount its view's tag, which the views runtime records
/// on the ref, has now (T124, decision 0120). Nothing goes the other way.
template <>
struct Convert<ui::ComponentView> {
  static ui::ComponentView fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
};

// --- promises ------------------------------------------------------------------------------

/// Settles `host`'s JS promise `id` like `p`, once `p` settles: on the JS
/// thread, where its value converts holding the calling actor (`p`'s). If
/// the host is torn down first, the value is released on that actor.
/// Traced (`traceId`), the result's wait for the JS thread and its
/// delivery are spans of that id, the delivery named after `site`.
template <class T>
void settleLater(Host& host, uint64_t id, const Promise<T>& p, uint64_t traceId = 0, const trace::Site* site = nullptr) {
  std::weak_ptr<Host> weak = host.weak_from_this();
  Actor* actor = &currentActor();

  p.onSettled([p, weak, id, traceId, site, actor] {
    auto host = weak.lock();
    if (!host) return;

    trace::Mark wait = traceId ? trace::begin(trace::Category::Queue, "js.wait") : trace::Mark{};

    host->postToJs([p, id, weak, traceId, site, wait, actor](jsi::Runtime& rt) {
      auto host = weak.lock();
      if (!host) return;

      trace::end(wait, trace::Category::Queue, "js.wait", {.id = traceId});
      std::optional<trace::Scope> delivery;
      if (traceId) delivery.emplace(trace::Category::Completion, site ? site->name : "completion", site, traceId);

      RuntimeEntry entry(host->id());
      LucentScope scope(*actor);
      if (!p.fulfilled()) {
        host->reject(rt, id, host->errorToJs(rt, p.error()));
        return;
      }

      jsi::Value value = jsi::Value::undefined();
      if constexpr (!std::is_void_v<T>) {
        // Whatever the conversion throws (a JS error, a Lucent one, an
        // allocation failure) rejects: it never escapes the JS thread's task.
        try {
          value = Convert<T>::toJs(rt, *host, p.value());
        } catch (const jsi::JSError& e) {
          host->reject(rt, id, jsi::Value(rt, e.value()));
          return;
        } catch (...) {
          host->reject(rt, id, host->errorToJs(rt, currentError(std::current_exception())));
          return;
        }
      }

      host->resolve(rt, id, value);
    });
  });
}

/// Hands a Lucent promise to JavaScript: the JS promise settles on the JS
/// thread when the Lucent one does.
/// A promise of an attached runtime whose creator gave it no scheduler,
/// which could never settle: rejected at once (decision 0123). None for
/// any other host.
std::optional<jsi::Value> unscheduledPromise(jsi::Runtime& rt, Host& host);
/// What a call to an async export from an attached runtime returns while
/// no module state lasts: rejected with what checkUsable throws. None
/// otherwise.
std::optional<jsi::Value> unusablePromise(jsi::Runtime& rt, Host& host);

template <class T>
struct Convert<Promise<T>> {
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Promise<ValueOf<T>>& p) {
    if (h.attached()) [[unlikely]]
      if (auto rejected = unscheduledPromise(rt, h)) return std::move(*rejected);

    uint64_t id = 0;
    jsi::Value jsPromise = h.createPromise(rt, id);
    settleLater(h, id, p);
    return jsPromise;
  }
  /// A JS promise passed into Lucent (e.g. returned by a callback).
  static Promise<ValueOf<T>> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);
};

// --- functions -------------------------------------------------------------------------------

/// What a call from an attached runtime throws while no module state
/// lasts (decision 0123): the runtime that kept it is gone.
inline void checkUsable(jsi::Runtime& rt, Host& host) {
  if (host.attached()) [[unlikely]]
    host.throwIfUnusable(rt);
}

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

// --- opaque values ------------------------------------------------------------------------

/// A JSValue: the host's reference to the value JavaScript gave, released on
/// the JS thread when the last Lucent reference goes.
class HeldJsValue final : public JSValueObject {
 public:
  HeldJsValue(Host& host, uint64_t id) : host_(host.weak_from_this()), id_(id) {}
  ~HeldJsValue() override {
    if (auto h = host_.lock()) h->releaseValue(id_);
  }
  std::shared_ptr<Host> host() const { return host_.lock(); }
  uint64_t id() const { return id_; }

 private:
  std::weak_ptr<Host> host_;
  uint64_t id_;
};

/// Any value JavaScript gives, undefined and null included, kept as it is;
/// given back, the same value. One of another runtime, or of a host a
/// reload replaced, is refused (decision 0123).
template <>
struct Convert<JSValue> {
  static JSValue fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path&) {
    Host& host = Host::get(rt);
    return std::make_shared<HeldJsValue>(host, host.retainValue(rt, jsi::Value(rt, v)));
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const JSValue& v) {
    auto held = std::dynamic_pointer_cast<HeldJsValue>(v);
    auto host = held ? held->host() : nullptr;
    const jsi::Value* value = host.get() == &h && h.alive() ? h.retainedValue(held->id()) : nullptr;
    if (!value) throwTypeError("a JSValue of another JavaScript runtime, or of one a reload replaced, cannot be given to this one");
    return jsi::Value(rt, *value);
  }
};

template <class T>
struct IsPromiseType : std::false_type {};
template <class T>
struct IsPromiseType<Promise<T>> : std::true_type {};

template <class R, class... A>
struct Convert<Fn<R(A...)>> {
  /// The function's Lucent type: its result and parameters as values (ValueOf).
  using RV = ValueOf<R>;
  using F = Fn<RV(ValueOf<A>...)>;

  static F fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject() || !v.getObject(rt).isFunction(rt)) throwBoundaryError(rt, p, "a function", v);
    Host& host = Host::get(rt);
    auto cb = std::make_shared<JsCallback>(host, host.retain(rt, v.getObject(rt).getFunction(rt)));
    auto where = std::make_shared<const Site>(p, " (callback ", ")");
    return F([cb, where](ValueOf<A>... args) -> RV { return invoke(cb, where, std::move(args)...); });
  }

  static RV invoke(const std::shared_ptr<JsCallback>& cb, const std::shared_ptr<const Site>& where, ValueOf<A>... args) {
    auto host = cb->host();
    if (!host || !host->alive()) {
      if constexpr (std::is_void_v<RV>) return;
      else throwError(Host::goneError());
    }
    if (host->onJsThread()) {
      jsi::Runtime& rt = host->runtime();
      jsi::Function* fn = host->retained(cb->id());
      if (!fn) throwError(String::fromLatin1("Error"), String::fromLatin1("Callback was released"));
      jsi::Value result = jsi::Value::undefined();
      try {
        std::array<jsi::Value, sizeof...(A)> argv{Convert<A>::toJs(rt, *host, args)...};
        // JavaScript may wait for the main thread: it may enter the actors
        // this thread holds meanwhile, as this JavaScript could.
        ParkedActors parked;
        result = fn->call(rt, static_cast<const jsi::Value*>(argv.data()), argv.size());
      } catch (const jsi::JSError& e) {
        throw Exception(Host::errorFromJs(rt, e));
      }
      if constexpr (std::is_void_v<RV>) {
        return;
      } else {
        return Convert<R>::fromJs(rt, result, Path::at(*where, "return value"));
      }
    }
    Actor* actor = &currentActor();
    if constexpr (std::is_void_v<RV>) {
      std::weak_ptr<Host> weak = host;
      host->postToJs([cb, actor, args...](jsi::Runtime& rt) mutable {
        auto host = cb->host();
        if (!host) return;
        jsi::Function* fn = host->retained(cb->id());
        if (!fn) return;
        RuntimeEntry entry(host->id());
        LucentScope scope(*actor);
        try {
          std::array<jsi::Value, sizeof...(A)> argv{Convert<A>::toJs(rt, *host, args)...};
          ParkedActors parked;
          fn->call(rt, static_cast<const jsi::Value*>(argv.data()), argv.size());
        } catch (const jsi::JSError& e) {
          consoleWrite(ConsoleLevel::Error, String::fromUtf8("Uncaught error in callback: " + e.getMessage()));
        } catch (...) {
          reportUncaught(std::current_exception(), "callback");
        }
      });
      return;
    } else if constexpr (IsPromiseType<RV>::value) {
      RV out;
      // If the task never runs (the runtime went), the promise rejects.
      auto gone = [out] { out.reject(Host::goneError()); };
      host->postToJs([cb, out, where, actor, args...](jsi::Runtime& rt) mutable {
        auto host = cb->host();
        jsi::Function* fn = host ? host->retained(cb->id()) : nullptr;
        std::optional<RuntimeEntry> entry;
        if (host) entry.emplace(host->id());
        LucentScope scope(*actor);
        if (!fn) {
          out.reject(makeError(String::fromLatin1("Callback was released")));
          return;
        }
        try {
          jsi::Value result = jsi::Value::undefined();
          {
            std::array<jsi::Value, sizeof...(A)> argv{Convert<A>::toJs(rt, *host, args)...};
            ParkedActors parked;
            result = fn->call(rt, static_cast<const jsi::Value*>(argv.data()), argv.size());
          }
          RV inner = Convert<R>::fromJs(rt, result, Path::at(*where, "return value"));
          inner.onSettled([inner, out] {
            if (inner.fulfilled()) {
              if constexpr (std::is_void_v<typename RV::value_type>) out.resolve(undefined);
              else out.resolve(inner.value());
            } else {
              out.reject(inner.error());
            }
          });
        } catch (const jsi::JSError& e) {
          out.reject(Host::errorFromJs(rt, e));
        } catch (...) {
          out.reject(currentError(std::current_exception()));
        }
      }, gone);
      return out;
    } else {
      throwError(String::fromLatin1("Error"),
                 String::fromUtf8(where->text() + ": a callback that returns a value can only be called synchronously; make it return a Promise"));
    }
  }

  /// The function holds the actor it was made on: JavaScript's calls enter it.
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const F& f) {
    std::weak_ptr<Host> weak = h.weak_from_this();
    Actor* actor = &currentActor();
    return jsi::Function::createFromHostFunction(
        rt, jsi::PropNameID::forAscii(rt, "lucentFunction"), sizeof...(A),
        [f, weak, actor](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
          // A torn-down host's function answers through the runtime's host;
          // one a library carried into another runtime, through the host
          // attached there (decision 0123).
          auto kept = weak.lock();
          Host& host = kept && kept->alive() ? Host::from(rt, kept) : Host::get(rt);
          checkUsable(rt, host);
          RuntimeEntry entry(host.id());
          LucentScope scope(*actor, host.entersFromMain());
          try {
            return call(rt, host, f, args, count, std::index_sequence_for<A...>{});
          } catch (const Exception& e) {
            throw jsi::JSError(rt, host.errorToJs(rt, e.error()));
          }
        });
  }

 private:
  template <size_t... I>
  static jsi::Value call(jsi::Runtime& rt, Host& h, const F& f, const jsi::Value* args, size_t count, std::index_sequence<I...>) {
    static const jsi::Value undef = jsi::Value::undefined();
    if constexpr (std::is_void_v<RV>) {
      f(Convert<std::decay_t<A>>::fromJs(rt, I < count ? args[I] : undef, Path::argument("function", I))...);
      return jsi::Value::undefined();
    } else {
      return Convert<R>::toJs(rt, h, f(Convert<std::decay_t<A>>::fromJs(rt, I < count ? args[I] : undef, Path::argument("function", I))...));
    }
  }
};

template <class T>
Promise<ValueOf<T>> Convert<Promise<T>>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  Promise<ValueOf<T>> out;
  if (!v.isObject() || !v.getObject(rt).getProperty(rt, "then").isObject()) {
    // Not a thenable: behaves like `await value`.
    if constexpr (std::is_void_v<T>) out.resolve(undefined);
    else out.resolve(Convert<T>::fromJs(rt, v, p));
    return out;
  }

  // Rejected if the runtime's host is torn down before JavaScript settles
  // it, so what awaits it goes on (and releases what it holds). Settled
  // holding the actor that awaits it.
  Actor* actor = &currentActor();
  const std::shared_ptr<Scope> scope = Host::get(rt).scopeFor(*actor);
  Scope::CleanupId pending = scope->onDispose([out] { out.reject(Host::goneError()); });
  if (pending == 0) return out;

  auto settled = [owner = std::weak_ptr<Scope>(scope), pending] {
    if (auto s = owner.lock()) s->remove(pending);
  };

  auto where = std::make_shared<const Site>(p, " ", "");
  auto onFulfilled = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "onFulfilled"), 1,
      [out, where, settled, actor](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        settled();
        LucentScope scope(*actor);
        try {
          if constexpr (std::is_void_v<T>) out.resolve(undefined);
          else out.resolve(Convert<T>::fromJs(rt, arg(args, count, 0), Path::at(*where, "resolved value")));
        } catch (const jsi::JSError& e) {
          out.reject(Host::errorFromJs(rt, e));
        } catch (...) {
          out.reject(currentError(std::current_exception()));
        }
        return jsi::Value::undefined();
      });
  auto onRejected = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "onRejected"), 1,
      [out, settled, actor](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        settled();
        LucentScope scope(*actor);
        out.reject(Convert<Error>::fromJs(rt, arg(args, count, 0), Path{"promise", "rejection"}));
        return jsi::Value::undefined();
      });
  jsi::Object promise = v.getObject(rt);
  promise.getPropertyAsFunction(rt, "then").callWithThis(rt, promise, onFulfilled, onRejected);
  return out;
}

// --- helpers used by generated bindings ----------------------------------------------------


/// Runs a synchronous Lucent call from JS in `actor`, translating Lucent
/// errors into JS exceptions.
template <class F>
jsi::Value callSync(jsi::Runtime& rt, Host& host, Actor& actor, F&& body) {
  checkUsable(rt, host);
  RuntimeEntry entry(host.id());
  try {
    LucentScope scope(actor, host.entersFromMain());
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

/// A synchronous call from JS, traced as an entry at the export's site
/// (the compiler passes it: LUCENT_TRACE_SITE_AT).
template <class F>
jsi::Value callSync(jsi::Runtime& rt, Host& host, Actor& actor, const trace::Site* site, F&& body) {
  trace::Scope entry(trace::Category::Entry, site->name, site);
  return callSync(rt, host, actor, std::forward<F>(body));
}

/// A JS promise rejected with `reason`.
jsi::Value rejectedPromise(jsi::Runtime& rt, const jsi::Value& reason);

/// A call from JS of an async export: as callSync, but what converting its
/// arguments (or `this`) throws rejects the promise it returns, as an async
/// function's throw does, instead of throwing from the call.
template <class F>
jsi::Value callAsyncEntry(jsi::Runtime& rt, Host& host, Actor& actor, F&& body) {
  // From an attached runtime while no module state lasts (decision 0123).
  if (host.attached()) [[unlikely]]
    if (auto rejected = unusablePromise(rt, host)) return std::move(*rejected);

  RuntimeEntry entry(host.id());
  try {
    LucentScope scope(actor, host.entersFromMain());
    return body();
  } catch (const Exception& e) {
    return rejectedPromise(rt, host.errorToJs(rt, e.error()));
  } catch (const jsi::JSError& e) {
    return rejectedPromise(rt, e.value());
  } catch (const jsi::JSIException&) {
    throw;
  } catch (const std::exception&) {
    return rejectedPromise(rt, host.errorToJs(rt, currentError(std::current_exception())));
  }
}

/// In the shared actor.
template <class F>
jsi::Value callSync(jsi::Runtime& rt, Host& host, F&& body) {
  return callSync(rt, host, Actor::shared(), std::forward<F>(body));
}

template <class F>
jsi::Value callSync(jsi::Runtime& rt, Host& host, const trace::Site* site, F&& body) {
  return callSync(rt, host, Actor::shared(), site, std::forward<F>(body));
}

/// Starts an exported async function on `actor`'s thread and returns a JS
/// promise for its result, traced from the export's `site` (if any): the
/// call, the job it posts (its wait and its run), the result's wait for
/// the JS thread and its delivery share one id. `start` runs on the
/// actor's thread and returns the Lucent promise; it does not start if the
/// host is torn down first.
template <class T, class F>
jsi::Value callAsync(jsi::Runtime& rt, Host& host, Actor& actor, const trace::Site* site, F&& start) {
  if (host.attached()) [[unlikely]]
    if (auto rejected = unscheduledPromise(rt, host)) return std::move(*rejected);

  uint64_t traceId = site && trace::enabled() ? trace::newId() : 0;

  std::optional<trace::Scope> entry;
  std::optional<trace::Correlate> correlate;
  if (traceId) [[unlikely]] {
    entry.emplace(trace::Category::Entry, site->name, site, traceId);
    correlate.emplace(traceId);
  }

  uint64_t id = 0;
  jsi::Value jsPromise = host.createPromise(rt, id);
  std::weak_ptr<Host> weak = host.weak_from_this();

  // Run for this runtime: what it starts belongs to it.
  RuntimeEntry running(host.id());
  host.postToModule(actor, [weak, id, traceId, site, start = std::forward<F>(start)]() mutable {
    Promise<T> p;
    try {
      p = start();
    } catch (...) {
      p = Promise<T>::rejected(currentError(std::current_exception()));
    }

    if (auto host = weak.lock()) settleLater(*host, id, p, traceId, site);
  });

  return jsPromise;
}

template <class T, class F>
jsi::Value callAsync(jsi::Runtime& rt, Host& host, Actor& actor, F&& start) {
  return callAsync<T>(rt, host, actor, nullptr, std::forward<F>(start));
}

/// On the shared actor.
template <class T, class F>
jsi::Value callAsync(jsi::Runtime& rt, Host& host, F&& start) {
  return callAsync<T>(rt, host, Actor::shared(), nullptr, std::forward<F>(start));
}

template <class T, class F>
jsi::Value callAsync(jsi::Runtime& rt, Host& host, const trace::Site* site, F&& start) {
  return callAsync<T>(rt, host, Actor::shared(), site, std::forward<F>(start));
}

// --- events ------------------------------------------------------------------------------

/// An EventSubscription crosses as an object with `remove()`.
template <>
struct Convert<EventSubscription> {
  static EventSubscription fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    auto s = std::dynamic_pointer_cast<EventSubscriptionObject>(instanceOf(rt, v));
    if (!s) throwBoundaryError(rt, p, "an EventSubscription", v);
    return s;
  }

  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const EventSubscription& s) {
    return h.wrap(rt, s, "lucent:EventSubscription", proto);
  }

 private:
  static void proto(jsi::Runtime& rt, Host& host, jsi::Object& proto) {
    defineFunction(rt, proto, "remove", 0,
                   [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) -> jsi::Value {
                     Host& host = Host::from(rt, installed);
                     auto s = fromJs(rt, self, Path{"EventSubscription.remove", "this"});
                     return callSync(rt, host, s->actor(), [&]() -> jsi::Value {
                       s->remove();
                       return jsi::Value::undefined();
                     });
                   });
  }
};

template <class F>
struct ListenerArgs;
template <class... A>
struct ListenerArgs<Fn<void(A...)>> {
  using Tuple = std::tuple<std::decay_t<A>...>;
};

/// An EventEmitter crosses as the same JS object each time, with
/// `addListener(name, listener)`, `emit(name, ...args)`,
/// `listenerCount(name)` and `removeAllListeners(name?)`. A listener
/// JavaScript adds is called as any JS callback Lucent holds: at once on
/// the JS thread, posted from elsewhere. It belongs to this runtime: a
/// reload removes it.
template <class... Fns>
struct Convert<Ref<EventEmitterObject<Fns...>>> {
  using Emitter = EventEmitterObject<Fns...>;

  static Ref<Emitter> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    auto e = std::dynamic_pointer_cast<Emitter>(instanceOf(rt, v));
    if (!e) throwBoundaryError(rt, p, "an EventEmitter", v);
    return e;
  }

  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Ref<Emitter>& e) {
    static const std::string key = std::string("lucent:EventEmitter:") + typeid(Emitter).name();
    return h.wrap(rt, e, key.c_str(), proto);
  }

 private:
  /// The index of the event JavaScript names, or a TypeError naming the events there are.
  static size_t event(jsi::Runtime& rt, const Emitter& e, const jsi::Value& name, const char* method) {
    if (!name.isString()) throwBoundaryError(rt, Path{method, "argument 'name'"}, "a string", name);
    std::string n = name.getString(rt).utf8(rt);
    size_t i = e.indexOf(n);
    if (i < Emitter::kEvents) return i;
    std::string known;
    for (const auto& k : e.names()) known += (known.empty() ? "\"" : ", \"") + k + "\"";
    throwTypeError((std::string(method) + ": unknown event \"" + n + "\" (" + (known.empty() ? "it has none" : known) + ")").c_str());
  }

  template <class F>
  static void define(jsi::Runtime& rt, Host& host, jsi::Object& proto, const char* name, unsigned argc, F body) {
    defineFunction(rt, proto, name, argc,
                   [installed = host.shared_from_this(), body, name](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value* args, size_t count) -> jsi::Value {
                     Host& host = Host::from(rt, installed);
                     // In the actor of the module that made the emitter, as its own code runs.
                     Actor& actor = fromJs(rt, self, Path{name, "this"})->actor();
                     return callSync(rt, host, actor, [&]() -> jsi::Value { return body(rt, host, self, args, count); });
                   });
  }

  template <class T, size_t... I>
  static T argsFromJs(jsi::Runtime& rt, const jsi::Value* args, size_t count, std::index_sequence<I...>) {
    return T{Convert<std::tuple_element_t<I, T>>::fromJs(rt, arg(args, count, I + 1), Path::argument("EventEmitter.emit", I + 1))...};
  }

 public:
  /// An emitter's methods on `proto`: its own, or a prototype of a class extending EventEmitter.
  static void proto(jsi::Runtime& rt, Host& host, jsi::Object& proto) {
    define(rt, host, proto, "addListener", 2, [](jsi::Runtime& rt, Host& host, const jsi::Value& self, const jsi::Value* args, size_t count) {
      auto e = fromJs(rt, self, Path{"EventEmitter.addListener", "this"});
      size_t i = event(rt, *e, arg(args, count, 0), "EventEmitter.addListener");
      jsi::Value out = jsi::Value::undefined();
      detail::withIndex<Emitter::kEvents>(i, [&](auto I) {
        using F = typename Emitter::template Listener<decltype(I)::value>;
        constexpr size_t event = decltype(I)::value;
        F fn = Convert<F>::fromJs(rt, arg(args, count, 1), Path{"EventEmitter.addListener", "argument 'listener'"});
        std::weak_ptr<Host> weak = host.weak_from_this();
        auto alive = [weak] {
          auto h = weak.lock();
          return h && h->alive();
        };
        uint64_t id = 0;
        EventSubscription added = e->template addListener<event>(std::move(fn), alive, &id);
        // The runtime's teardown takes the listener, in the emitter's actor,
        // where onObserved hears it go; removed first, it forgets that.
        std::shared_ptr<Scope> scope = host.scopeFor(e->actor());
        std::weak_ptr<Emitter> emitter = e;
        Scope::CleanupId cleanup = scope->onDispose([emitter, id] {
          if (auto self = emitter.lock()) {
            LucentScope lock(self->actor());
            self->template removeListener<event>(id);
          }
        });
        std::weak_ptr<Scope> owner = scope;
        auto subscription = std::make_shared<EventSubscriptionObject>([added, owner, cleanup] {
          added->remove();
          if (auto s = owner.lock()) s->remove(cleanup);
        });
        out = Convert<EventSubscription>::toJs(rt, host, subscription);
      });
      return out;
    });
    define(rt, host, proto, "emit", 1, [](jsi::Runtime& rt, Host&, const jsi::Value& self, const jsi::Value* args, size_t count) {
      auto e = fromJs(rt, self, Path{"EventEmitter.emit", "this"});
      size_t i = event(rt, *e, arg(args, count, 0), "EventEmitter.emit");
      detail::withIndex<Emitter::kEvents>(i, [&](auto I) {
        using Tuple = typename ListenerArgs<typename Emitter::template Listener<decltype(I)::value>>::Tuple;
        Tuple values = argsFromJs<Tuple>(rt, args, count, std::make_index_sequence<std::tuple_size_v<Tuple>>{});
        std::apply([&](auto&... v) { e->template emit<decltype(I)::value>(v...); }, values);
      });
      return jsi::Value::undefined();
    });
    define(rt, host, proto, "listenerCount", 1, [](jsi::Runtime& rt, Host&, const jsi::Value& self, const jsi::Value* args, size_t count) {
      auto e = fromJs(rt, self, Path{"EventEmitter.listenerCount", "this"});
      return jsi::Value(e->listenerCount(event(rt, *e, arg(args, count, 0), "EventEmitter.listenerCount")));
    });
    define(rt, host, proto, "removeAllListeners", 1, [](jsi::Runtime& rt, Host&, const jsi::Value& self, const jsi::Value* args, size_t count) {
      auto e = fromJs(rt, self, Path{"EventEmitter.removeAllListeners", "this"});
      if (arg(args, count, 0).isUndefined()) e->removeAllListeners();
      else e->removeAllListeners(event(rt, *e, arg(args, count, 0), "EventEmitter.removeAllListeners"));
      return jsi::Value::undefined();
    });
  }
};

/// A class extending EventEmitter: its instances' prototype has an emitter's methods, which
/// find the emitter the instance is.
template <class Emitter>
void defineEmitterPrototype(jsi::Runtime& rt, Host& host, jsi::Object& proto) {
  Convert<Ref<Emitter>>::proto(rt, host, proto);
}

}  // namespace lucent::js
