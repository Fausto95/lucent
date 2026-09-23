#include "jsstring.h"

#if defined(__APPLE__) && !defined(LUCENT_PORTABLE_COLLATION)
#include <CoreFoundation/CoreFoundation.h>
#elif defined(__ANDROID__) && !defined(LUCENT_PORTABLE_COLLATION)
#include <fbjni/fbjni.h>
#endif

#include <algorithm>
#include <cctype>
#include <array>
#include <cmath>
#include <cstring>
#include <vector>

#include "number.h"

namespace lucent {

namespace {

// Clamp a JS relative index (ToIntegerOrInfinity + clamping) into [0, len].
size_t clampIndex(double v, size_t len) {
  if (std::isnan(v)) return 0;
  v = std::trunc(v);
  if (v < 0) {
    v += static_cast<double>(len);
    return v < 0 ? 0 : static_cast<size_t>(v);
  }
  return v > static_cast<double>(len) ? len : static_cast<size_t>(v);
}

// ToIntegerOrInfinity clamped to [0, len] without negative wrap-around.
size_t clampPositive(double v, size_t len) {
  if (std::isnan(v) || v <= 0) return 0;
  v = std::trunc(v);
  return v > static_cast<double>(len) ? len : static_cast<size_t>(v);
}

void appendUtf8(std::string& out, uint32_t cp) {
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
}

// Simple (1:1) case mappings for the scripts most text uses. Code points
// outside these ranges map to themselves.
char16_t upperOf(char16_t c) {
  if (c < 0x80) return (c >= 'a' && c <= 'z') ? c - 32 : c;
  if (c == 0xB5) return 0x39C;
  if (c >= 0xE0 && c <= 0xFE && c != 0xF7) return c - 32;
  if (c == 0xFF) return 0x178;
  if (c >= 0x100 && c <= 0x17F) {
    if (c == 0x131) return 'I';
    if (c == 0x17F) return 'S';
    if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c % 2 == 0) ? c - 1 : c;
    if (c == 0x130 || c == 0x138 || c == 0x149 || c == 0x178) return c;
    return (c % 2 == 1) ? c - 1 : c;
  }
  if (c >= 0x3B1 && c <= 0x3C9) return c == 0x3C2 ? 0x3A3 : c - 32;
  if (c >= 0x3AC && c <= 0x3AF) {
    static const char16_t map[] = {0x386, 0x388, 0x389, 0x38A};
    return map[c - 0x3AC];
  }
  if (c >= 0x430 && c <= 0x44F) return c - 32;
  if (c >= 0x450 && c <= 0x45F) return c - 80;
  return c;
}

char16_t lowerOf(char16_t c) {
  if (c < 0x80) return (c >= 'A' && c <= 'Z') ? c + 32 : c;
  if (c >= 0xC0 && c <= 0xDE && c != 0xD7) return c + 32;
  if (c == 0x178) return 0xFF;
  if (c >= 0x100 && c <= 0x17F) {
    if (c == 0x130) return 'i';
    if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c % 2 == 1) ? c + 1 : c;
    if (c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F) return c;
    return (c % 2 == 0) ? c + 1 : c;
  }
  if (c >= 0x391 && c <= 0x3A9 && c != 0x3A2) return c + 32;
  if (c >= 0x386 && c <= 0x38A) {
    switch (c) {
      case 0x386: return 0x3AC;
      case 0x388: return 0x3AD;
      case 0x389: return 0x3AE;
      case 0x38A: return 0x3AF;
      default: return c;
    }
  }
  if (c >= 0x410 && c <= 0x42F) return c + 32;
  if (c >= 0x400 && c <= 0x40F) return c + 80;
  return c;
}

}  // namespace

bool isJsWhitespace(char16_t c) {
  switch (c) {
    case 0x09: case 0x0A: case 0x0B: case 0x0C: case 0x0D: case 0x20: case 0xA0:
    case 0x1680: case 0x2028: case 0x2029: case 0x202F: case 0x205F: case 0x3000: case 0xFEFF:
      return true;
    default:
      return c >= 0x2000 && c <= 0x200A;
  }
}

String String::make(std::string&& latin1) {
  if (latin1.empty()) return String();
  auto d = std::make_shared<Data>();
  d->oneByte = true;
  d->bytes = std::move(latin1);
  return String(std::move(d));
}

String String::make(std::u16string&& wide) {
  if (wide.empty()) return String();
  bool narrow = true;
  for (char16_t c : wide) {
    if (c > 0xFF) {
      narrow = false;
      break;
    }
  }
  auto d = std::make_shared<Data>();
  if (narrow) {
    d->oneByte = true;
    d->bytes.resize(wide.size());
    for (size_t i = 0; i < wide.size(); i++) d->bytes[i] = static_cast<char>(wide[i]);
  } else {
    d->oneByte = false;
    d->wide = std::move(wide);
  }
  return String(std::move(d));
}

String String::fromLatin1(std::string_view bytes) { return make(std::string(bytes)); }

String String::fromUtf8(std::string_view s) {
  bool ascii = true;
  for (unsigned char c : s) {
    if (c >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return make(std::string(s));
  std::u16string out;
  out.reserve(s.size());
  size_t i = 0;
  const size_t n = s.size();
  auto cont = [&](size_t k) -> int {
    if (i + k >= n) return -1;
    unsigned char c = static_cast<unsigned char>(s[i + k]);
    return (c & 0xC0) == 0x80 ? (c & 0x3F) : -1;
  };
  while (i < n) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    uint32_t cp = 0xFFFD;
    size_t len = 1;
    if (c < 0x80) {
      cp = c;
    } else if ((c & 0xE0) == 0xC0) {
      int a = cont(1);
      if (a >= 0 && c >= 0xC2) {
        cp = ((c & 0x1F) << 6) | a;
        len = 2;
      }
    } else if ((c & 0xF0) == 0xE0) {
      int a = cont(1), b = cont(2);
      if (a >= 0 && b >= 0) {
        uint32_t v = ((c & 0x0F) << 12) | (a << 6) | b;
        if (v >= 0x800) {
          cp = v;
          len = 3;
        }
      }
    } else if ((c & 0xF8) == 0xF0) {
      int a = cont(1), b = cont(2), d = cont(3);
      if (a >= 0 && b >= 0 && d >= 0) {
        uint32_t v = ((c & 0x07) << 18) | (a << 12) | (b << 6) | d;
        if (v >= 0x10000 && v <= 0x10FFFF) {
          cp = v;
          len = 4;
        }
      }
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
      out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
    } else {
      out.push_back(static_cast<char16_t>(cp));
    }
    i += len;
  }
  return make(std::move(out));
}

String String::fromUtf16(const char16_t* units, size_t length) { return make(std::u16string(units, length)); }

String String::fromCodeUnit(char16_t unit) {
  if (unit <= 0xFF) {
    // Shared, like JavaScript engines' single-character strings. `+=` never
    // grows a shared string in place, so the cache cannot change.
    static const auto* cache = [] {
      auto* c = new std::array<String, 256>();
      for (int i = 0; i < 256; i++) (*c)[i] = make(std::string(1, static_cast<char>(i)));
      return c;
    }();
    return (*cache)[unit];
  }
  return make(std::u16string(1, unit));
}

String String::fromCodePoint(double v) {
  if (!(v >= 0 && v <= 0x10FFFF) || std::trunc(v) != v) throwRangeError("Invalid code point");
  uint32_t cp = static_cast<uint32_t>(v);
  if (cp < 0x10000) return fromCodeUnit(static_cast<char16_t>(cp));
  cp -= 0x10000;
  char16_t pair[2] = {static_cast<char16_t>(0xD800 + (cp >> 10)), static_cast<char16_t>(0xDC00 + (cp & 0x3FF))};
  return fromUtf16(pair, 2);
}

std::string String::toUtf8() const {
  if (!d_) return std::string();
  std::string out;
  if (d_->oneByte) {
    out.reserve(d_->bytes.size());
    for (unsigned char c : d_->bytes) appendUtf8(out, c);
    return out;
  }
  const auto& w = d_->wide;
  out.reserve(w.size() * 2);
  for (size_t i = 0; i < w.size(); i++) {
    char16_t c = w[i];
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < w.size() && w[i + 1] >= 0xDC00 && w[i + 1] <= 0xDFFF) {
      uint32_t cp = 0x10000 + ((c - 0xD800) << 10) + (w[i + 1] - 0xDC00);
      appendUtf8(out, cp);
      i++;
    } else if (c >= 0xD800 && c <= 0xDFFF) {
      appendUtf8(out, 0xFFFD);
    } else {
      appendUtf8(out, c);
    }
  }
  return out;
}

std::u16string String::toUtf16() const {
  std::u16string out;
  appendUnitsTo(out);
  return out;
}

void String::appendUnitsTo(std::u16string& out) const {
  if (!d_) return;
  if (d_->oneByte) {
    out.reserve(out.size() + d_->bytes.size());
    for (unsigned char c : d_->bytes) out.push_back(c);
  } else {
    out.append(d_->wide);
  }
}

String operator+(const String& a, const String& b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  if (a.d_->oneByte && b.d_->oneByte) {
    std::string s;
    s.reserve(a.d_->bytes.size() + b.d_->bytes.size());
    s.append(a.d_->bytes).append(b.d_->bytes);
    return String::make(std::move(s));
  }
  std::u16string w;
  w.reserve(a.length() + b.length());
  a.appendUnitsTo(w);
  b.appendUnitsTo(w);
  auto d = std::make_shared<String::Data>();
  d->oneByte = false;
  d->wide = std::move(w);
  return String(std::move(d));
}

StringBuilder::StringBuilder(size_t capacity, bool oneByte) : oneByte_(oneByte) {
  if (oneByte) bytes_.reserve(capacity);
  else wide_.reserve(capacity);
}

void StringBuilder::append(const String& s) {
  if (s.empty()) return;
  if (oneByte_ && s.isOneByte()) {
    bytes_.append(s.latin1());
    return;
  }
  if (oneByte_) {
    // Parts were promised Latin-1; widen what was built so far.
    wide_.reserve(bytes_.size() + s.length());
    for (unsigned char b : bytes_) wide_.push_back(b);
    bytes_.clear();
    oneByte_ = false;
  }
  s.appendUnitsTo(wide_);
}

void StringBuilder::appendAscii(std::string_view ascii) {
  if (oneByte_) bytes_.append(ascii);
  else wide_.append(ascii.begin(), ascii.end());
}

String StringBuilder::build() && {
  if (oneByte_) return String::make(std::move(bytes_));
  return String::make(std::move(wide_));
}

String& String::operator+=(const String& other) {
  if (other.empty()) return *this;
  if (!d_) {
    *this = other;
    return *this;
  }
  if (d_.use_count() == 1) {
    // Sole owner: grow in place so a `+=` loop is amortized linear.
    d_->hash.store(0, std::memory_order_relaxed);
    if (d_->oneByte && other.d_->oneByte) {
      d_->bytes.append(other.d_->bytes);
      return *this;
    }
    if (d_->oneByte) {
      std::u16string w;
      w.reserve((d_->bytes.size() + other.length()) * 2);
      for (unsigned char c : d_->bytes) w.push_back(c);
      d_->bytes.clear();
      d_->bytes.shrink_to_fit();
      d_->oneByte = false;
      d_->wide = std::move(w);
    }
    other.appendUnitsTo(d_->wide);
    return *this;
  }
  *this = *this + other;
  return *this;
}

bool operator==(const String& a, const String& b) {
  if (a.d_ == b.d_) return true;
  size_t n = a.length();
  if (n != b.length()) return false;
  if (n == 0) return true;
  if (a.d_->oneByte && b.d_->oneByte) return a.d_->bytes == b.d_->bytes;
  if (!a.d_->oneByte && !b.d_->oneByte) return a.d_->wide == b.d_->wide;
  // Mixed representations never compare equal: a wide string always holds a
  // unit > 0xFF (make() narrows otherwise).
  return false;
}

int String::compare(const String& a, const String& b) {
  size_t n = std::min(a.length(), b.length());
  for (size_t i = 0; i < n; i++) {
    char16_t x = a.unit(i), y = b.unit(i);
    if (x != y) return x < y ? -1 : 1;
  }
  if (a.length() == b.length()) return 0;
  return a.length() < b.length() ? -1 : 1;
}

size_t String::hash() const {
  if (!d_) return 0x9e3779b9;
  size_t h = d_->hash.load(std::memory_order_relaxed);
  if (h != 0) return h;
  // FNV-1a over code units, so both representations hash alike.
  uint64_t x = 1469598103934665603ULL;
  size_t n = length();
  for (size_t i = 0; i < n; i++) {
    x ^= unit(i);
    x *= 1099511628211ULL;
  }
  h = static_cast<size_t>(x) | 1;
  d_->hash.store(h, std::memory_order_relaxed);
  return h;
}

String String::sub(size_t begin, size_t end) const {
  size_t n = length();
  if (end > n) end = n;
  if (begin >= end) return String();
  if (begin == 0 && end == n) return *this;
  if (d_->oneByte) return make(d_->bytes.substr(begin, end - begin));
  return make(d_->wide.substr(begin, end - begin));
}

size_t String::find(const String& needle, size_t from) const {
  size_t n = length(), m = needle.length();
  if (m == 0) return from <= n ? from : std::string::npos;
  if (m > n) return std::string::npos;
  if (isOneByte() && needle.isOneByte()) {
    return d_->bytes.find(needle.d_->bytes, from);
  }
  for (size_t i = from; i + m <= n; i++) {
    size_t j = 0;
    while (j < m && unit(i + j) == needle.unit(j)) j++;
    if (j == m) return i;
  }
  return std::string::npos;
}

double String::charCodeAt(double index) const {
  if (std::isnan(index)) index = 0;
  index = std::trunc(index);
  if (index < 0 || index >= static_cast<double>(length())) return std::nan("");
  return unit(static_cast<size_t>(index));
}

String String::charAt(double index) const {
  if (std::isnan(index)) index = 0;
  index = std::trunc(index);
  if (index < 0 || index >= static_cast<double>(length())) return String();
  return fromCodeUnit(unit(static_cast<size_t>(index)));
}

Opt<String> String::at(double index) const {
  if (std::isnan(index)) index = 0;
  index = std::trunc(index);
  double n = static_cast<double>(length());
  if (index < 0) index += n;
  if (index < 0 || index >= n) return undefined;
  return fromCodeUnit(unit(static_cast<size_t>(index)));
}

Opt<double> String::codePointAt(double index) const {
  if (std::isnan(index)) index = 0;
  index = std::trunc(index);
  if (index < 0 || index >= static_cast<double>(length())) return undefined;
  size_t i = static_cast<size_t>(index);
  char16_t c = unit(i);
  if (c >= 0xD800 && c <= 0xDBFF && i + 1 < length()) {
    char16_t d = unit(i + 1);
    if (d >= 0xDC00 && d <= 0xDFFF) return static_cast<double>(0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00));
  }
  return static_cast<double>(c);
}

double String::indexOf(const String& search, double from) const {
  size_t start = clampPositive(from, length());
  size_t r = find(search, start);
  return r == std::string::npos ? -1 : static_cast<double>(r);
}

double String::lastIndexOf(const String& search) const {
  return lastIndexOf(search, static_cast<double>(length()));
}

double String::lastIndexOf(const String& search, double from) const {
  size_t n = length(), m = search.length();
  if (m > n) return -1;
  size_t start = std::isnan(from) ? n - m : std::min(clampPositive(from, n), n - m);
  for (size_t i = start + 1; i-- > 0;) {
    size_t j = 0;
    while (j < m && unit(i + j) == search.unit(j)) j++;
    if (j == m) return static_cast<double>(i);
  }
  return -1;
}

bool String::startsWith(const String& search, double from) const {
  size_t start = clampPositive(from, length());
  size_t m = search.length();
  if (start + m > length()) return false;
  for (size_t j = 0; j < m; j++) {
    if (unit(start + j) != search.unit(j)) return false;
  }
  return true;
}

bool String::endsWith(const String& search) const { return endsWith(search, static_cast<double>(length())); }

bool String::endsWith(const String& search, double endPosition) const {
  size_t end = clampPositive(endPosition, length());
  size_t m = search.length();
  if (m > end) return false;
  size_t start = end - m;
  for (size_t j = 0; j < m; j++) {
    if (unit(start + j) != search.unit(j)) return false;
  }
  return true;
}

String String::slice(double start) const { return sub(clampIndex(start, length()), length()); }

String String::slice(double start, double end) const {
  return sub(clampIndex(start, length()), clampIndex(end, length()));
}

String String::substring(double start) const { return sub(clampPositive(start, length()), length()); }

String String::substring(double start, double end) const {
  size_t a = clampPositive(start, length()), b = clampPositive(end, length());
  return a <= b ? sub(a, b) : sub(b, a);
}

namespace {

#include "unicode_data.inc"

template <class Table, size_t N>
const Table* findByCodePoint(const Table (&table)[N], uint32_t cp) {
  size_t lo = 0, hi = N;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    if (table[mid].cp < cp) lo = mid + 1;
    else hi = mid;
  }
  return lo < N && table[lo].cp == cp ? &table[lo] : nullptr;
}

template <size_t N>
bool inRanges(const CodePointRange (&table)[N], uint32_t cp) {
  size_t lo = 0, hi = N;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    if (table[mid].last < cp) lo = mid + 1;
    else hi = mid;
  }
  return lo < N && table[lo].first <= cp;
}

/// The code point at `i` (lone surrogates are code points of their own).
uint32_t codePointAt(const String& s, size_t i, size_t& width) {
  char16_t c = s.unit(i);
  width = 1;
  if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length()) {
    char16_t d = s.unit(i + 1);
    if (d >= 0xDC00 && d <= 0xDFFF) {
      width = 2;
      return 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
    }
  }
  return c;
}

/// The code point that ends before `i`.
uint32_t codePointBefore(const String& s, size_t i, size_t& width) {
  char16_t c = s.unit(i - 1);
  width = 1;
  if (c >= 0xDC00 && c <= 0xDFFF && i >= 2) {
    char16_t h = s.unit(i - 2);
    if (h >= 0xD800 && h <= 0xDBFF) {
      width = 2;
      return 0x10000 + ((h - 0xD800) << 10) + (c - 0xDC00);
    }
  }
  return c;
}

void appendCodePoint(std::u16string& out, uint32_t cp) {
  if (cp < 0x10000) {
    out.push_back(static_cast<char16_t>(cp));
  } else {
    cp -= 0x10000;
    out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
    out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
  }
}

/// Unicode's Final_Sigma: a cased letter before (past case-ignorables), none after.
bool isFinalSigma(const String& s, size_t i) {
  bool casedBefore = false;
  for (size_t j = i; j > 0;) {
    size_t w;
    uint32_t cp = codePointBefore(s, j, w);
    j -= w;
    if (inRanges(kCaseIgnorable, cp)) continue;
    casedBefore = inRanges(kCased, cp);
    break;
  }
  if (!casedBefore) return false;
  for (size_t k = i + 1; k < s.length();) {
    size_t w;
    uint32_t cp = codePointAt(s, k, w);
    k += w;
    if (inRanges(kCaseIgnorable, cp)) continue;
    return !inRanges(kCased, cp);
  }
  return true;
}

template <size_t N>
String mapCase(const String& s, const CaseMapping (&table)[N], bool lower) {
  std::u16string out;
  out.reserve(s.length());
  for (size_t i = 0; i < s.length();) {
    size_t w;
    uint32_t cp = codePointAt(s, i, w);
    if (lower && cp == 0x03A3) {
      out.push_back(isFinalSigma(s, i) ? u'\u03C2' : u'\u03C3');
    } else if (const CaseMapping* m = findByCodePoint(table, cp)) {
      out.append(m->units, m->length);
    } else {
      appendCodePoint(out, cp);
    }
    i += w;
  }
  return String::fromUtf16(out);
}

}  // namespace

String String::toUpperCase() const {
  size_t n = length();
  if (n == 0) return *this;
  if (isOneByte()) {
    // Latin-1 maps within Latin-1 except ß (SS), µ (Μ) and ÿ (Ÿ).
    bool special = false;
    std::string out(d_->bytes);
    for (auto& ch : out) {
      unsigned char c = static_cast<unsigned char>(ch);
      if (c == 0xDF || c == 0xB5 || c == 0xFF) {
        special = true;
        break;
      }
      ch = static_cast<char>(upperOf(c));
    }
    if (!special) return make(std::move(out));
  }
  return mapCase(*this, kUpperCase, false);
}

String String::toLowerCase() const {
  size_t n = length();
  if (n == 0) return *this;
  if (isOneByte()) {
    std::string out(d_->bytes);
    for (auto& ch : out) ch = static_cast<char>(lowerOf(static_cast<unsigned char>(ch)));
    return make(std::move(out));
  }
  return mapCase(*this, kLowerCase, true);
}

String String::trim() const {
  size_t b = 0, e = length();
  while (b < e && isJsWhitespace(unit(b))) b++;
  while (e > b && isJsWhitespace(unit(e - 1))) e--;
  return sub(b, e);
}

String String::trimStart() const {
  size_t b = 0, e = length();
  while (b < e && isJsWhitespace(unit(b))) b++;
  return sub(b, e);
}

String String::trimEnd() const {
  size_t e = length();
  while (e > 0 && isJsWhitespace(unit(e - 1))) e--;
  return sub(0, e);
}

String String::repeat(double count) const {
  if (std::isnan(count)) count = 0;
  count = std::trunc(count);
  if (count < 0 || std::isinf(count)) throwRangeError("Invalid count value");
  if (count == 0 || empty()) return String();
  if (count * static_cast<double>(length()) > (1u << 29)) throwRangeError("Invalid string length");
  size_t c = static_cast<size_t>(count);
  if (isOneByte()) {
    std::string out;
    out.reserve(length() * c);
    for (size_t i = 0; i < c; i++) out.append(d_->bytes);
    return make(std::move(out));
  }
  std::u16string out;
  out.reserve(length() * c);
  for (size_t i = 0; i < c; i++) out.append(d_->wide);
  return make(std::move(out));
}

static String pad(const String& s, double target, const String& fill, bool atStart) {
  if (std::isnan(target)) return s;
  target = std::trunc(target);
  if (target <= static_cast<double>(s.length()) || fill.empty()) return s;
  if (target > (1u << 29)) throwRangeError("Invalid string length");
  size_t need = static_cast<size_t>(target) - s.length();
  std::u16string p;
  p.reserve(need);
  while (p.size() < need) {
    for (size_t i = 0; i < fill.length() && p.size() < need; i++) p.push_back(fill.unit(i));
  }
  String padding = String::fromUtf16(p);
  return atStart ? padding + s : s + padding;
}

String String::padStart(double targetLength, const String& fill) const { return pad(*this, targetLength, fill, true); }
String String::padEnd(double targetLength, const String& fill) const { return pad(*this, targetLength, fill, false); }

String String::replace(const String& search, const String& replacement) const {
  size_t at = find(search, 0);
  if (at == std::string::npos) return *this;
  return sub(0, at) + replacement + sub(at + search.length(), length());
}

String String::replaceAll(const String& search, const String& replacement) const {
  std::u16string out;
  size_t n = length(), m = search.length();
  if (m == 0) {
    // "ab".replaceAll("", "-") === "-a-b-"
    for (size_t i = 0; i < n; i++) {
      replacement.appendUnitsTo(out);
      out.push_back(unit(i));
    }
    replacement.appendUnitsTo(out);
    return make(std::move(out));
  }
  size_t pos = 0;
  for (;;) {
    size_t at = find(search, pos);
    if (at == std::string::npos) break;
    for (size_t i = pos; i < at; i++) out.push_back(unit(i));
    replacement.appendUnitsTo(out);
    pos = at + m;
  }
  if (pos == 0) return *this;
  for (size_t i = pos; i < n; i++) out.push_back(unit(i));
  return make(std::move(out));
}

#if defined(__APPLE__) && !defined(LUCENT_PORTABLE_COLLATION)

// Like Hermes on Apple platforms: CoreFoundation with the current locale,
// comparing canonically equivalent strings as equal.
double String::localeCompare(const String& other) const {
  std::u16string a = toUtf16(), b = other.toUtf16();
  CFStringRef s1 = CFStringCreateWithCharacters(nullptr, reinterpret_cast<const UniChar*>(a.data()), static_cast<CFIndex>(a.size()));
  CFStringRef s2 = CFStringCreateWithCharacters(nullptr, reinterpret_cast<const UniChar*>(b.data()), static_cast<CFIndex>(b.size()));
  CFLocaleRef locale = CFLocaleCopyCurrent();
  CFComparisonResult r = CFStringCompareWithOptionsAndLocale(s1, s2, CFRangeMake(0, CFStringGetLength(s1)), kCFCompareLocalized | kCFCompareNonliteral, locale);
  CFRelease(s1);
  CFRelease(s2);
  CFRelease(locale);
  return r == kCFCompareLessThan ? -1 : r == kCFCompareGreaterThan ? 1 : 0;
}

#elif defined(__ANDROID__) && !defined(LUCENT_PORTABLE_COLLATION)

// Like Hermes on Android: java.text.Collator for the default locale.
double String::localeCompare(const String& other) const {
  JNIEnv* env = facebook::jni::Environment::ensureCurrentThreadIsAttached();
  static jclass collatorClass = static_cast<jclass>(env->NewGlobalRef(env->FindClass("java/text/Collator")));
  static jmethodID getInstance = env->GetStaticMethodID(collatorClass, "getInstance", "()Ljava/text/Collator;");
  static jmethodID compare = env->GetMethodID(collatorClass, "compare", "(Ljava/lang/String;Ljava/lang/String;)I");
  std::u16string a = toUtf16(), b = other.toUtf16();
  jstring ja = env->NewString(reinterpret_cast<const jchar*>(a.data()), static_cast<jsize>(a.size()));
  jstring jb = env->NewString(reinterpret_cast<const jchar*>(b.data()), static_cast<jsize>(b.size()));
  jobject collator = env->CallStaticObjectMethod(collatorClass, getInstance);
  jint r = env->CallIntMethod(collator, compare, ja, jb);
  env->DeleteLocalRef(collator);
  env->DeleteLocalRef(ja);
  env->DeleteLocalRef(jb);
  return r < 0 ? -1 : r > 0 ? 1 : 0;
}

#else

namespace {

// A small approximation of root collation for hosts without a platform
// collator (tests on Linux): base letters first (whitespace, then
// punctuation and symbols, then digits, then letters), then accents, then
// case with lowercase first.
struct CollationElement {
  int group;
  uint32_t base;
  uint32_t accent;
  bool upper;
};

std::vector<CollationElement> collationElements(const String& s) {
  std::vector<CollationElement> out;
  for (size_t i = 0; i < s.length();) {
    size_t w;
    uint32_t cp = codePointAt(s, i, w);
    i += w;
    uint32_t base = cp, accent = 0;
    if (cp < 0x10000) {
      if (const Decomposition* d = findByCodePoint(kDecompositions, cp)) {
        base = d->base;
        accent = d->accent;
      }
    }
    bool upper = false;
    if (const CaseMapping* m = findByCodePoint(kLowerCase, base); m && m->length == 1) {
      base = m->units[0];
      upper = true;
    }
    int group = 3;
    if (base == ' ' || base == '\t' || base == '\n' || base == '\r') group = 0;
    else if (base < 0x80 && std::ispunct(static_cast<int>(base))) group = 1;
    else if (base >= '0' && base <= '9') group = 2;
    out.push_back({group, base, accent, upper});
  }
  return out;
}

template <class Key>
int compareLevel(const std::vector<CollationElement>& a, const std::vector<CollationElement>& b, Key key) {
  size_t n = std::min(a.size(), b.size());
  for (size_t i = 0; i < n; i++) {
    auto x = key(a[i]), y = key(b[i]);
    if (x != y) return x < y ? -1 : 1;
  }
  return a.size() == b.size() ? 0 : a.size() < b.size() ? -1 : 1;
}

}  // namespace

double String::localeCompare(const String& other) const {
  auto a = collationElements(*this), b = collationElements(other);
  if (int r = compareLevel(a, b, [](const CollationElement& e) { return std::make_pair(e.group, e.base); })) return r;
  if (int r = compareLevel(a, b, [](const CollationElement& e) { return e.accent; })) return r;
  if (int r = compareLevel(a, b, [](const CollationElement& e) { return e.upper; })) return r;
  return static_cast<double>(compare(*this, other));
}

#endif

}  // namespace lucent
