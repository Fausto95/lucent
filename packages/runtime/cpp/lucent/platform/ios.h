// Lucent runtime — Objective-C glue helpers for *.ios.lucent.ts units
// (compiled as Objective-C++ with ARC).
#pragma once

#import <Foundation/Foundation.h>

#include "../jsstring.h"
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

/// `available("ios", major, minor)`.
inline bool available(double major, double minor = 0) {
  NSOperatingSystemVersion v = {static_cast<NSInteger>(major), static_cast<NSInteger>(minor), 0};
  return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:v];
}

}  // namespace lucent::objc
