// Lucent runtime — Objective-C glue helpers for *.ios.lucent.ts units
// (compiled as Objective-C++ with ARC).
#pragma once

#import <objc/runtime.h>
#import <Foundation/Foundation.h>

#include <functional>
#include <initializer_list>
#include <memory>
#include <variant>

#include "../array.h"
#include "../bigint.h"
#include "../bytes.h"
#include "../date.h"
#include "../jsstring.h"
#include "../map.h"
#include "../native.h"
#include "../report.h"

// Lucent code checks the OS before using an API newer than the deployment
// target (LUCENT3007), with available(), which Clang does not see as a check:
// the glue that includes this header uses them unwarned.
#pragma clang diagnostic ignored "-Wunguarded-availability"
#pragma clang diagnostic ignored "-Wunguarded-availability-new"

namespace lucent::objc {

inline void releaseObject(void* retained) { CFRelease(retained); }

/// Installs the view tree a debug build's snapshot shows (ios_debug.mm): the host's to call.
void installViewTree();

/// A Lucent reference to `obj` (retained), released on the main thread:
/// UIKit objects must be deallocated there, and the last Lucent reference
/// can go on any thread. Throws TypeError for nil.
inline NativeRef wrap(id obj, const char* what) {
  if (!obj) throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + " returned nil")));
  return NativeRef((__bridge_retained void*)obj, releaseObject, nullptr, &ExecutionContext::main());
}
inline Opt<NativeRef> wrapOpt(id obj) {
  if (!obj) return Opt<NativeRef>(null);
  return wrap(obj, "");
}
inline id unwrap(const NativeRef& r) { return (__bridge id)r.get(); }
inline id unwrap(const Opt<NativeRef>& r) { return r.has() ? (__bridge id)r.get().get() : nil; }

inline NSString* toNSString(const String& s) {
  std::u16string units = s.toUtf16();
  return [NSString stringWithCharacters:reinterpret_cast<const unichar*>(units.data()) length:units.size()];
}
inline String fromNSString(NSString* s, const char* what) {
  if (!s) throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + " returned nil")));
  NSUInteger n = s.length;
  std::u16string units(n, u'\0');
  [s getCharacters:reinterpret_cast<unichar*>(units.data()) range:NSMakeRange(0, n)];
  return String::fromUtf16(units);
}
inline Opt<String> fromNSStringOpt(NSString* s) {
  if (!s) return Opt<String>(null);
  return fromNSString(s, "");
}

inline NSString* toNSStringOpt(const Opt<String>& s) { return s.has() ? toNSString(s.get()) : nil; }

[[noreturn]] inline void returnedNil(const char* what) {
  throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + " returned nil")));
}

// --- values copied at the boundary ---------------------------------------------------

inline NSData* toNSData(const Bytes& b) { return [NSData dataWithBytes:b.data() length:b.size()]; }
inline Bytes fromNSData(NSData* d, const char* what) {
  if (!d) returnedNil(what);
  return Bytes::copy(static_cast<const uint8_t*>(d.bytes), d.length);
}
inline Opt<Bytes> fromNSDataOpt(NSData* d) { return d ? Opt<Bytes>(fromNSData(d, "")) : Opt<Bytes>(null); }

inline NSDate* toNSDate(const Date& d) { return [NSDate dateWithTimeIntervalSince1970:d->getTime() / 1000.0]; }
inline Date fromNSDate(NSDate* d, const char* what) {
  if (!d) returnedNil(what);
  return makeDate(d.timeIntervalSince1970 * 1000.0);
}
inline Opt<Date> fromNSDateOpt(NSDate* d) { return d ? Opt<Date>(fromNSDate(d, "")) : Opt<Date>(null); }

template <class T, class F>
NSArray* toNSArray(const Array<T>& a, F toObject) {
  NSMutableArray* out = [NSMutableArray arrayWithCapacity:a.size()];
  for (size_t i = 0; i < a.size(); i++) {
    id v = toObject(a.at(i));
    [out addObject:v ?: [NSNull null]];
  }
  return out;
}
/// An array of `items` (objects, never nil): a Swift tuple's elements, as its shim takes them.
template <class... T>
NSArray* toNSArrayOf(T... items) {
  id all[] = {items...};
  return [NSArray arrayWithObjects:all count:sizeof...(T)];
}

template <class T, class F>
Array<T> fromNSArray(NSArray* a, F fromObject, const char* what) {
  if (!a) returnedNil(what);
  Array<T> out;
  for (id v in a) out.push(fromObject(v));
  return out;
}
template <class T, class F>
Opt<Array<T>> fromNSArrayOpt(NSArray* a, F fromObject) {
  return a ? Opt<Array<T>>(fromNSArray<T>(a, fromObject, "")) : Opt<Array<T>>(null);
}

template <class T, class F>
NSSet* toNSSet(const Set<T>& s, F toObject) {
  NSMutableSet* out = [NSMutableSet setWithCapacity:static_cast<NSUInteger>(s.size())];
  Array<T> items = s.values();
  for (size_t i = 0; i < items.size(); i++) {
    id v = toObject(items.at(i));
    [out addObject:v ?: [NSNull null]];
  }
  return out;
}
template <class T, class F>
Set<T> fromNSSet(NSSet* s, F fromObject, const char* what) {
  if (!s) returnedNil(what);
  Set<T> out;
  for (id v in s) out.add(fromObject(v));
  return out;
}
template <class T, class F>
Opt<Set<T>> fromNSSetOpt(NSSet* s, F fromObject) {
  return s ? Opt<Set<T>>(fromNSSet<T>(s, fromObject, "")) : Opt<Set<T>>(null);
}

template <class V, class F>
NSDictionary* toNSDictionary(const Dict<V>& d, F toObject) {
  NSMutableDictionary* out = [NSMutableDictionary dictionary];
  Array<String> keys = d.keys();
  for (size_t i = 0; i < keys.size(); i++) {
    id v = toObject(d.get(keys.at(i)).get());
    out[toNSString(keys.at(i))] = v ?: [NSNull null];
  }
  return out;
}
/// Entries with keys that are not strings are left out.
template <class V, class F>
Dict<V> fromNSDictionary(NSDictionary* d, F fromObject, const char* what) {
  if (!d) returnedNil(what);
  Dict<V> out;
  for (id k in d) {
    if (![k isKindOfClass:[NSString class]]) continue;
    out.set(fromNSString(k, what), fromObject(d[k]));
  }
  return out;
}
template <class V, class F>
Opt<Dict<V>> fromNSDictionaryOpt(NSDictionary* d, F fromObject) {
  return d ? Opt<Dict<V>>(fromNSDictionary<V>(d, fromObject, "")) : Opt<Dict<V>>(null);
}

/// Applies `f` to a value that may be absent; absent gives a null pointer
/// (of f's result type: a nil object, block or CoreFoundation reference).
template <class T, class F>
auto ifPresent(const Opt<T>& v, F f) -> decltype(f(v.get())) {
  using R = decltype(f(v.get()));
  if (v.has()) return f(v.get());

  return R(nullptr);
}
template <class T, class F>
  requires(!IsOpt<T>::value)
auto ifPresent(const T& v, F f) {
  return f(v);
}
template <class F>
std::nullptr_t ifPresent(const Null&, F) {
  return nullptr;
}
template <class F>
std::nullptr_t ifPresent(const Undefined&, F) {
  return nullptr;
}

// --- Any (id) --------------------------------------------------------------------------

inline id toId(const String& s) { return toNSString(s); }
inline id toId(double v) { return @(v); }
inline id toId(bool v) { return @(v); }
inline id toId(const Bytes& b) { return toNSData(b); }
inline id toId(const Date& d) { return toNSDate(d); }
inline id toId(const NativeRef& r) { return unwrap(r); }
inline id toId(const Null&) { return nil; }
inline id toId(const Undefined&) { return nil; }
template <class... Ts>
id toId(const std::variant<Ts...>& v) {
  return std::visit([](const auto& x) -> id { return toId(x); }, v);
}
template <class T>
id toId(const Opt<T>& v) {
  return v.has() ? toId(v.get()) : nil;
}

/// `asString(value)` and friends from lucent:ios: Swift's `as? String`.
inline Opt<String> asString(const Opt<NativeRef>& o) {
  id x = unwrap(o);
  return [x isKindOfClass:[NSString class]] ? Opt<String>(fromNSString(x, "")) : Opt<String>(null);
}
inline Opt<double> asNumber(const Opt<NativeRef>& o) {
  id x = unwrap(o);
  return [x isKindOfClass:[NSNumber class]] ? Opt<double>([(NSNumber*)x doubleValue]) : Opt<double>(null);
}
inline Opt<bool> asBoolean(const Opt<NativeRef>& o) {
  id x = unwrap(o);
  return [x isKindOfClass:[NSNumber class]] ? Opt<bool>(static_cast<bool>([(NSNumber*)x boolValue])) : Opt<bool>(null);
}
inline Opt<Bytes> asData(const Opt<NativeRef>& o) {
  id x = unwrap(o);
  return [x isKindOfClass:[NSData class]] ? Opt<Bytes>(fromNSData(x, "")) : Opt<Bytes>(null);
}
inline Opt<Date> asDate(const Opt<NativeRef>& o) {
  id x = unwrap(o);
  return [x isKindOfClass:[NSDate class]] ? Opt<Date>(fromNSDate(x, "")) : Opt<Date>(null);
}

// --- C structs, as Swift shims pass them: their bytes ----------------------------------

template <class S>
NSData* structBytes(const S& s) {
  return [NSData dataWithBytes:&s length:sizeof(S)];
}
template <class S>
S structFromBytes(id data) {
  S s{};
  [(NSData*)data getBytes:&s length:sizeof(S)];
  return s;
}

// --- Swift enums with payloads ---------------------------------------------------------

/// A case of a Swift enum with payloads, as the shims pass it: {"kind": case, field: payload…}.
inline id swiftCase(NSString* kind, std::initializer_list<std::pair<const char*, id>> payload) {
  NSMutableDictionary* d = [NSMutableDictionary dictionaryWithObject:kind forKey:@"kind"];
  // An absent optional payload is left out.
  for (const auto& [field, value] : payload)
    if (value) d[@(field)] = value;
  return d;
}
inline id swiftCase(const char* kind, std::initializer_list<std::pair<const char*, id>> payload) {
  return swiftCase(@(kind), payload);
}
/// Cases whose payloads have the same fields share an object type in Lucent: its kind says which.
inline id swiftCase(const String& kind, std::initializer_list<std::pair<const char*, id>> payload) {
  return swiftCase(toNSString(kind), payload);
}
inline bool isSwiftCase(id c, const char* kind) {
  return [((NSDictionary*)c)[@"kind"] isEqualToString:@(kind)];
}
/// A payload of a case, nil for an absent optional one (NSNull from Swift).
inline id swiftPayload(id c, const char* field) {
  id v = ((NSDictionary*)c)[@(field)];
  return v == [NSNull null] ? nil : v;
}
[[noreturn]] inline void unknownSwiftCase(id c, const char* type) {
  throw Exception(makeError(String::fromLatin1("TypeError"),
                            String::fromUtf8(std::string(type) + " has no case " + [[((NSDictionary*)c)[@"kind"] description] UTF8String])));
}

// --- errors ----------------------------------------------------------------------------

/// The domain of the NSErrors Lucent errors become (toNSError).
inline NSString* const lucentErrorDomain = @"Lucent";

/// An NSError as a Lucent error: code "<domain>:<code>". One toNSError made
/// is the Lucent error it was made from again: its name, message and code.
inline Error fromNSError(NSError* e, const char* what) {
  if (!e) throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + " got no error")));

  NSString* name = [e.domain isEqualToString:lucentErrorDomain] ? e.userInfo[@"LucentErrorName"] : nil;
  if (name) {
    Error err = makeError(fromNSString(name, ""), fromNSString(e.localizedDescription ?: @"", ""));
    if (NSString* code = e.userInfo[@"LucentErrorCode"]) err->code = fromNSString(code, "");
    return err;
  }

  Error err = makeError(String::fromLatin1("Error"), fromNSString(e.localizedDescription ?: @"", ""));
  err->code = fromNSString([NSString stringWithFormat:@"%@:%ld", e.domain, (long)e.code], "");
  return err;
}

/// A Lucent error as an NSError, for Swift to throw where Lucent code
/// implements a throwing requirement: its message as the description, its
/// name and code kept for the way back (fromNSError).
inline NSError* toNSError(const Error& e) {
  NSMutableDictionary* info = [NSMutableDictionary dictionary];
  info[NSLocalizedDescriptionKey] = toNSString(e->message);
  info[@"LucentErrorName"] = toNSString(e->name);
  if (e->code.has()) info[@"LucentErrorCode"] = toNSString(e->code.get());

  return [NSError errorWithDomain:lucentErrorDomain code:0 userInfo:info];
}

/// In a catch: what was thrown, as the NSError a Swift requirement's error
/// out-parameter takes (retained).
inline void setError(void** out) {
  *out = (__bridge_retained void*)toNSError(currentError(std::current_exception()));
}

/// Reports an error Swift has no way to receive (a requirement that does not throw).
inline void reportError(const Error& e, const char* where) {
  reportUncaught(std::make_exception_ptr(Exception(e)), where);
}
inline Opt<Error> fromNSErrorOpt(NSError* e) { return e ? Opt<Error>(fromNSError(e, "")) : Opt<Error>(null); }

/// A method's NSError** result as a thrown Lucent error.
inline void throwIfError(NSError* e) {
  if (e) throw Exception(fromNSError(e, ""));
}

// --- blocks ----------------------------------------------------------------------------

/// One Objective-C object per `key` (a Lucent object) while the object is
/// alive: `make` creates it. Callers hold the Lucent lock. Each `Table`
/// has its own: a Lucent object's Objective-C and Swift delegates differ.
template <int Table = 0>
id cachedObject(const void* key, id (^make)(void)) {
  static NSMapTable* objects = [NSMapTable strongToWeakObjectsMapTable];
  NSValue* k = [NSValue valueWithPointer:key];
  id o = [objects objectForKey:k];
  if (!o) {
    o = make();
    [objects setObject:o forKey:k];
  }
  return o;
}

// --- Lucent classes extending Objective-C classes ------------------------------------
//
// A generated subclass of the base stands for each instance: it holds the
// Lucent object, and Lucent references to the object hold it (nativeOwned).

/// The native object of each Lucent object extending an Objective-C class,
/// by the Lucent object's address; held weakly, as the native one holds it.
inline NSMapTable* subclassObjects() {
  static NSMapTable* objects = [NSMapTable strongToWeakObjectsMapTable];
  return objects;
}

inline void adoptSubclassObject(const void* lucent, id object) {
  [subclassObjects() setObject:object forKey:[NSValue valueWithPointer:lucent]];
}

inline id subclassObject(const void* lucent) {
  return [subclassObjects() objectForKey:[NSValue valueWithPointer:lucent]];
}

/// The native object `lucent` is, for the members it inherits.
inline NativeRef nativeOfSubclass(const void* lucent, const char* what) {
  id o = subclassObject(lucent);
  if (!o) throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + ": its native object is gone")));
  return wrap(o, what);
}

/// A reference to `o` that holds its native object, which holds `o`: an
/// aliasing reference, so the two go together. Before the native object is
/// made (in the constructor, before super(…)), the Lucent object's own.
template <class T>
Ref<T> nativeOwned(T* o) {
  id x = subclassObject(o);
  if (!x) return std::static_pointer_cast<T>(static_cast<Object*>(o)->shared_from_this());
  return Ref<T>(std::make_shared<NativeRef>(wrap(x, "")), o);
}

/// A C++ callable as a heap block of type `Block` (the platform may keep it).
template <class Block, class F>
Block block(F f) {
  Block b = std::move(f);
  return b;
}

// --- out-parameters --------------------------------------------------------------------

/// `new Out()` from lucent:ios: what a method writes through a pointer, and
/// (for inout pointers) reads first. An object as a CFTypeRef; a number, an
/// enum or a BOOL as a number; a 64-bit integer as a bigint; a C struct as
/// the Lucent object it converts to.
struct OutSlot {
  CFTypeRef value = nullptr;
  bool owned = false;
  Opt<double> number = Opt<double>(null);
  Opt<BigInt> integer = Opt<BigInt>(null);
  std::shared_ptr<Object> record;
  ~OutSlot() {
    if (value && owned) CFRelease(value);
  }
};
inline OutSlot* slotOf(const NativeRef& r) { return static_cast<OutSlot*>(r.get()); }
inline OutSlot* slotOf(const Opt<NativeRef>& r) { return r.has() ? slotOf(r.get()) : nullptr; }
/// Released on the main thread, like the object it may hold.
inline NativeRef makeOut() {
  return NativeRef(new OutSlot(), [](void* p) { delete static_cast<OutSlot*>(p); }, nullptr, &ExecutionContext::main());
}
/// The slot for a call; `owned` per CoreFoundation's Create/Copy rule.
inline CFTypeRef* outSlot(const NativeRef& r, bool owned) {
  auto* s = static_cast<OutSlot*>(r.get());
  if (s->value && s->owned) CFRelease(s->value);
  s->value = nullptr;
  s->owned = owned;
  return &s->value;
}
inline CFTypeRef* outSlot(const Opt<NativeRef>& r, bool owned) { return r.has() ? outSlot(r.get(), owned) : nullptr; }
inline Opt<NativeRef> outValue(const NativeRef& r) { return wrapOpt((__bridge id) slotOf(r)->value); }

/**
 * An object pointer argument (`NSDate **`, `NSError **`) writing into an
 * Out: the method writes an autoreleased object, which the slot retains
 * when the call's full expression ends (before any autorelease pool
 * drains). `T` is the pointee, `NSDate*` or `id`.
 */
template <class T>
class ObjectOut {
 public:
  explicit ObjectOut(const NativeRef& out) : ObjectOut(slotOf(out)) {}
  explicit ObjectOut(const Opt<NativeRef>& out) : ObjectOut(slotOf(out)) {}
  ~ObjectOut() {
    if (!slot_) return;
    if (slot_->value && slot_->owned) CFRelease(slot_->value);
    slot_->value = object_ ? CFBridgingRetain(object_) : nullptr;
    slot_->owned = true;
  }
  ObjectOut(const ObjectOut&) = delete;
  ObjectOut& operator=(const ObjectOut&) = delete;
  T __autoreleasing* ptr() { return slot_ ? reinterpret_cast<T __autoreleasing*>(&object_) : nullptr; }

 private:
  explicit ObjectOut(OutSlot* slot) : slot_(slot), object_(slot ? (__bridge T)slot->value : nil) {}
  OutSlot* slot_;
  T __unsafe_unretained object_;
};
using ErrorOut = ObjectOut<NSError*>;

/// A 64-bit integer (NSInteger, int64_t, NSUInteger): a bigint in Lucent.
template <class T>
constexpr bool kWideInteger = std::is_integral_v<T> && sizeof(T) == 8;

/// A number, enum or BOOL pointer argument (`CGFloat *`): the slot's number
/// goes in, and the method's comes out; a 64-bit integer's (`NSInteger *`)
/// as a bigint, exactly.
template <class T>
class NumberOut {
 public:
  explicit NumberOut(const NativeRef& out) : NumberOut(slotOf(out)) {}
  explicit NumberOut(const Opt<NativeRef>& out) : NumberOut(slotOf(out)) {}

  ~NumberOut() {
    if (!slot_) return;

    if constexpr (kWideInteger<T>) slot_->integer = Opt<BigInt>(BigInt(value_));
    else slot_->number = Opt<double>(static_cast<double>(value_));
  }

  NumberOut(const NumberOut&) = delete;
  NumberOut& operator=(const NumberOut&) = delete;
  T* ptr() { return slot_ ? &value_ : nullptr; }

 private:
  static T in(OutSlot* slot) {
    if constexpr (kWideInteger<T>) {
      return slot && slot->integer.has() ? toNativeInteger<T>(slot->integer.get(), "an Out's value") : T{};
    } else {
      return slot && slot->number.has() ? static_cast<T>(slot->number.get()) : T{};
    }
  }

  explicit NumberOut(OutSlot* slot) : slot_(slot), value_(in(slot)) {}

  OutSlot* slot_;
  T value_;
};

/// A C struct pointer argument (`NSRange *`), converted to and from the Lucent object the slot holds.
template <class T>
class StructOut {
 public:
  using ToC = std::function<T(const std::shared_ptr<Object>&)>;
  using FromC = std::function<std::shared_ptr<Object>(const T&)>;
  StructOut(const NativeRef& out, ToC toC, FromC fromC) : StructOut(slotOf(out), toC, std::move(fromC)) {}
  StructOut(const Opt<NativeRef>& out, ToC toC, FromC fromC) : StructOut(slotOf(out), toC, std::move(fromC)) {}
  ~StructOut() {
    if (slot_) slot_->record = fromC_(value_);
  }
  StructOut(const StructOut&) = delete;
  StructOut& operator=(const StructOut&) = delete;
  T* ptr() { return slot_ ? &value_ : nullptr; }

 private:
  StructOut(OutSlot* slot, const ToC& toC, FromC fromC)
      : slot_(slot), value_(slot && slot->record ? toC(slot->record) : T{}), fromC_(std::move(fromC)) {}
  OutSlot* slot_;
  T value_;
  FromC fromC_;
};

inline Opt<Error> outError(const NativeRef& r) { return fromNSErrorOpt((__bridge NSError*) slotOf(r)->value); }
inline Opt<double> outNumber(const NativeRef& r) { return slotOf(r)->number; }
inline Opt<BigInt> outBigInt(const NativeRef& r) { return slotOf(r)->integer; }
inline Opt<bool> outBool(const NativeRef& r) {
  const Opt<double>& n = slotOf(r)->number;
  return n.has() ? Opt<bool>(n.get() != 0) : Opt<bool>(null);
}
/// The struct a method wrote, as the Lucent object type `S` it converts to.
template <class S>
Opt<Ref<S>> outRecord(const NativeRef& r) {
  const auto& o = slotOf(r)->record;
  return o ? Opt<Ref<S>>(std::static_pointer_cast<S>(o)) : Opt<Ref<S>>(null);
}

inline void setOutObject(const NativeRef& r, id v) {
  OutSlot* s = slotOf(r);
  if (s->value && s->owned) CFRelease(s->value);
  s->value = v ? CFBridgingRetain(v) : nullptr;
  s->owned = true;
}
/// A pointer a block receives (`BOOL *stop`) as an Out, holding what it points to.
template <class T>
NativeRef outOf(T* p) {
  NativeRef out = makeOut();
  if (!p) return out;

  if constexpr (kWideInteger<T>) slotOf(out)->integer = Opt<BigInt>(BigInt(*p));
  else slotOf(out)->number = Opt<double>(static_cast<double>(*p));
  return out;
}
/// What the Lucent function set, written back through the block's pointer.
template <class T>
void writeOut(const NativeRef& out, T* p) {
  if (!p) return;

  if constexpr (kWideInteger<T>) {
    const Opt<BigInt>& n = slotOf(out)->integer;
    if (n.has()) *p = toNativeInteger<T>(n.get(), "an Out's value");
  } else {
    const Opt<double>& n = slotOf(out)->number;
    if (n.has()) *p = static_cast<T>(n.get());
  }
}

// `out.value = x`: what an inout pointer passes in. Each gives the value assigned.
inline double setOut(const NativeRef& r, double v) {
  slotOf(r)->number = Opt<double>(v);
  return v;
}
inline BigInt setOut(const NativeRef& r, BigInt v) {
  slotOf(r)->integer = Opt<BigInt>(v);
  return v;
}
inline bool setOut(const NativeRef& r, bool v) {
  slotOf(r)->number = Opt<double>(v ? 1.0 : 0.0);
  return v;
}
template <class S>
Ref<S> setOut(const NativeRef& r, Ref<S> v) {
  slotOf(r)->record = std::static_pointer_cast<Object>(v);
  return v;
}
inline NativeRef setOut(const NativeRef& r, NativeRef v) {
  setOutObject(r, unwrap(v));
  return v;
}
inline String setOut(const NativeRef& r, String v) {
  setOutObject(r, toNSString(v));
  return v;
}
inline Date setOut(const NativeRef& r, Date v) {
  setOutObject(r, toNSDate(v));
  return v;
}
inline Bytes setOut(const NativeRef& r, Bytes v) {
  setOutObject(r, toNSData(v));
  return v;
}
template <class T>
Opt<T> setOut(const NativeRef& r, Opt<T> v) {
  if (v.has()) {
    setOut(r, v.get());
  } else {
    OutSlot* s = slotOf(r);
    if (s->value && s->owned) CFRelease(s->value);
    s->value = nullptr;
    s->number = Opt<double>(null);
    s->integer = Opt<BigInt>(null);
    s->record.reset();
  }
  return v;
}

/// `mainQueue()` from lucent:ios: the main dispatch queue (an OS object).
inline NativeRef mainQueue() { return wrap(dispatch_get_main_queue(), "mainQueue"); }

/// `serialQueue(label)` from lucent:ios: a new serial dispatch queue (an OS
/// object, released with its last reference).
inline NativeRef serialQueue(const String& label) {
  std::string name = label.toUtf8();
  return wrap(dispatch_queue_create(name.c_str(), DISPATCH_QUEUE_SERIAL), "serialQueue");
}

/// `available("ios", major, minor)`.
inline bool available(double major, double minor = 0) {
  NSOperatingSystemVersion v = {static_cast<NSInteger>(major), static_cast<NSInteger>(minor), 0};
  return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:v];
}

}  // namespace lucent::objc
