// Lucent runtime — the Web Crypto API's random values: crypto.getRandomValues
// and crypto.randomUUID, from the platform's secure generator.
#pragma once

#include <cstddef>
#include <cstdint>

#include "bytes.h"
#include "jserror.h"
#include "jsstring.h"

namespace lucent {

/// Fills `n` bytes from the platform's secure generator: arc4random_buf on
/// Apple's platforms, getrandom (or /dev/urandom) on Android and Linux.
void secureRandom(uint8_t* bytes, size_t n);

/// The most bytes one getRandomValues call fills, as the standard says.
constexpr size_t kRandomQuota = 65536;

[[noreturn]] void randomQuotaExceeded();

/// `crypto.getRandomValues(array)`: the array itself, filled. The compiler
/// takes integer arrays only; past 65536 bytes, a QuotaExceededError.
template <class K>
TypedArray<K> getRandomValues(const TypedArray<K>& array) {
  TypedArray<K> filled = array;
  const size_t n = static_cast<size_t>(filled.byteLength());
  if (n > kRandomQuota) randomQuotaExceeded();
  secureRandom(filled.data(), n);
  return filled;
}

/// `crypto.randomUUID()`: a version 4 UUID, in lowercase.
String randomUUID();

}  // namespace lucent
