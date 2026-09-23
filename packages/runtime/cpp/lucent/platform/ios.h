// Lucent runtime — Objective-C glue helpers for *.ios.lucent.ts units
// (compiled as Objective-C++ with ARC).
#pragma once

#import <Foundation/Foundation.h>

#include <variant>

#include "../array.h"
#include "../bytes.h"
#include "../date.h"
#include "../jsstring.h"
#include "../map.h"
#include "../native.h"

namespace lucent::objc {

void releaseOnMain(void* retained);

/// A Lucent reference to `obj` (retained). Throws TypeError for nil.
inline NativeRef wrap(id obj, const char* what) {
  if (!obj) throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + " returned nil")));
  return NativeRef((__bridge_retained void*)obj, releaseOnMain, nullptr);
}
inline Opt<NativeRef> wrapOpt(id obj) {
  if (!obj) return Opt<NativeRef>(null);
  return NativeRef((__bridge_retained void*)obj, releaseOnMain, nullptr);
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

/// Applies `f` to a value that may be absent; absent gives a null pointer.
template <class T, class F>
auto ifPresent(const Opt<T>& v, F f) -> decltype(f(v.get())) {
  return v.has() ? f(v.get()) : nullptr;
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

// --- errors ----------------------------------------------------------------------------

/// An NSError as a Lucent error: code "<domain>:<code>".
inline Error fromNSError(NSError* e, const char* what) {
  if (!e) throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string(what) + " got no error")));
  Error err = makeError(String::fromLatin1("Error"), fromNSString(e.localizedDescription ?: @"", ""));
  err->code = fromNSString([NSString stringWithFormat:@"%@:%ld", e.domain, (long)e.code], "");
  return err;
}
inline Opt<Error> fromNSErrorOpt(NSError* e) { return e ? Opt<Error>(fromNSError(e, "")) : Opt<Error>(null); }

/// A method's NSError** result as a thrown Lucent error.
inline void throwIfError(NSError* e) {
  if (e) throw Exception(fromNSError(e, ""));
}

// --- blocks ----------------------------------------------------------------------------

/// A C++ callable as a heap block of type `Block` (the platform may keep it).
template <class Block, class F>
Block block(F f) {
  Block b = std::move(f);
  return b;
}

// --- out-parameters --------------------------------------------------------------------

/// `new Out()` from lucent:ios: a CFTypeRef a C function writes into.
struct OutSlot {
  CFTypeRef value = nullptr;
  bool owned = false;
  ~OutSlot() {
    if (value && owned) CFRelease(value);
  }
};
inline NativeRef makeOut() {
  return NativeRef(new OutSlot(), [](void* p) { delete static_cast<OutSlot*>(p); }, nullptr);
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
inline Opt<NativeRef> outValue(const NativeRef& r) { return wrapOpt((__bridge id) static_cast<OutSlot*>(r.get())->value); }

/// `available("ios", major, minor)`.
inline bool available(double major, double minor = 0) {
  NSOperatingSystemVersion v = {static_cast<NSInteger>(major), static_cast<NSInteger>(minor), 0};
  return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:v];
}

}  // namespace lucent::objc
