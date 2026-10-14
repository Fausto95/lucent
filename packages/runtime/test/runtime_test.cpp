// Unit tests for the Lucent C++ runtime. Built and run by
// `packages/runtime/test/run.sh` (optionally under ASan/UBSan).
#include <pthread.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <set>
#include <string>
#include <thread>

#include "lucent/lucent.h"

using namespace lucent;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                              \
  do {                                                                           \
    checks++;                                                                    \
    if (!(cond)) {                                                               \
      failures++;                                                                \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                            \
  } while (0)

#define CHECK_STR(expr, expected)                                                                       \
  do {                                                                                                  \
    checks++;                                                                                           \
    std::string actual__ = (expr).toUtf8();                                                             \
    if (actual__ != (expected)) {                                                                       \
      failures++;                                                                                       \
      std::fprintf(stderr, "%s:%d: %s == \"%s\", expected \"%s\"\n", __FILE__, __LINE__, #expr, actual__.c_str(), \
                   std::string(expected).c_str());                                                      \
    }                                                                                                   \
  } while (0)

#define CHECK_THROWS(expr, errName)                                            \
  do {                                                                      \
    checks++;                                                               \
    bool threw__ = false;                                                   \
    try {                                                                   \
      (void)(expr);                                                         \
    } catch (const Exception& e__) {                                        \
      threw__ = e__.error()->name.toUtf8() == (errName);                       \
    }                                                                       \
    if (!threw__) {                                                         \
      failures++;                                                           \
      std::fprintf(stderr, "%s:%d: expected %s from %s\n", __FILE__, __LINE__, errName, #expr); \
    }                                                                       \
  } while (0)

static String S(const char* s) { return String::fromUtf8(s); }

/// Runs `f` on a thread with a stack of `bytes` (smaller than iOS's 512 KB
/// default for secondary threads) and waits for it.
template <class F>
static void onSmallStack(size_t bytes, F f) {
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, bytes);

  pthread_t thread;
  auto run = [](void* p) -> void* {
    (*static_cast<F*>(p))();
    return nullptr;
  };
  pthread_create(&thread, &attr, run, &f);
  pthread_join(thread, nullptr);
  pthread_attr_destroy(&attr);
}

/// What generated code does on entry: recursion without end, and with one.
static double unending(double n) {
  checkStack();
  return unending(n + 1) + 1;
}
static double counted(double n) {
  checkStack();
  return n <= 0 ? 0 : counted(n - 1) + 1;
}

#if defined(__SANITIZE_THREAD__)
#define LUCENT_TEST_TSAN 1
#elif defined(__has_feature)
#if __has_feature(thread_sanitizer)
#define LUCENT_TEST_TSAN 1
#endif
#endif

/// The largest stack the recursion test fills: TSan keeps a shadow of each
/// thread's calls, about 64K entries, and filling 8 MB with frames writes
/// past it.
#ifdef LUCENT_TEST_TSAN
static constexpr size_t kLargestFilledStack = 1024 * 1024;
#else
static constexpr size_t kLargestFilledStack = 8 * 1024 * 1024;
#endif

/// Recursion past the stack's room throws a RangeError on every thread,
/// a small one included, which code catches; the stack works afterwards.
static void stackExhaustionThrows() {
  for (size_t bytes : {size_t(256 * 1024), kLargestFilledStack}) {
    std::string name;
    std::string message;
    double after = 0;
    onSmallStack(bytes, [&] {
      try {
        unending(0);
      } catch (const Exception& e) {
        name = e.error()->name.toUtf8();
        message = e.error()->message.toUtf8();
      }
      after = counted(1000);
    });
    CHECK(name == "RangeError");
    CHECK(message == "Maximum call stack size exceeded");
    CHECK(after == 1000);
  }
}

/// A regular expression nested deeper than the stack allows is refused
/// with a SyntaxError, as engines refuse one, instead of overflowing the
/// native stack. Nesting the stack has room for still compiles, and
/// matching it does not recurse.
static void deepRegExps() {
  auto nested = [](int depth, const char* open) {
    std::string src;
    for (int i = 0; i < depth; i++) src += open;
    src += "a";
    src += std::string(depth, ')');
    return String::fromUtf8(src);
  };

  bool refused = false;
  bool shallowWorks = false;
  std::string other;

  onSmallStack(256 * 1024, [&] {
    try {
      RegExp deep = std::make_shared<RegExpObject>(nested(200000, "(?:"), String());
      other = "compiled";
    } catch (const Exception& e) {
      refused = e.error()->name.toUtf8() == "SyntaxError";
      if (!refused) other = e.error()->name.toUtf8();
    }

    try {
      RegExp shallow = std::make_shared<RegExpObject>(nested(100, "("), String());
      shallowWorks = shallow->test(S("a"));
    } catch (const Exception& e) {
      other = "shallow: " + e.error()->name.toUtf8();
    }
  });

  CHECK(refused);
  CHECK(shallowWorks);
  CHECK(other.empty());
}

static void numbers() {
  CHECK_STR(numberToString(0), "0");
  CHECK_STR(numberToString(-0.0), "0");
  CHECK_STR(numberToString(1), "1");
  CHECK_STR(numberToString(-42), "-42");
  CHECK_STR(numberToString(0.1), "0.1");
  CHECK_STR(numberToString(0.1 + 0.2), "0.30000000000000004");
  CHECK_STR(numberToString(1.5), "1.5");
  CHECK_STR(numberToString(123.456), "123.456");
  CHECK_STR(numberToString(1e21), "1e+21");
  CHECK_STR(numberToString(1e20), "100000000000000000000");
  CHECK_STR(numberToString(1.5e-7), "1.5e-7");
  CHECK_STR(numberToString(0.000001), "0.000001");
  CHECK_STR(numberToString(1e-7), "1e-7");
  CHECK_STR(numberToString(123e-20), "1.23e-18");
  CHECK_STR(numberToString(5e-324), "5e-324");
  CHECK_STR(numberToString(1.7976931348623157e308), "1.7976931348623157e+308");
  CHECK_STR(numberToString(9007199254740993.0), "9007199254740992");
  CHECK_STR(numberToString(1e16), "10000000000000000");
  CHECK_STR(numberToString(123456789012345680000.0), "123456789012345680000");
  CHECK_STR(numberToString(kNaN), "NaN");
  CHECK_STR(numberToString(-kInfinity), "-Infinity");
  CHECK_STR(numberToString(255, 16), "ff");
  CHECK_STR(numberToString(-255, 2), "-11111111");
  CHECK_STR(numberToString(0.5, 2), "0.1");
  CHECK_STR(numberToString(3.75, 16), "3.c");
  CHECK_STR(numberToFixed(1.005, 2), "1.00");
  CHECK_STR(numberToFixed(0.5, 0), "1");
  CHECK_STR(numberToFixed(2.5, 0), "3");
  CHECK_STR(numberToFixed(-1.5, 0), "-2");
  CHECK_STR(numberToFixed(1.45, 1), "1.4");
  CHECK_STR(numberToFixed(123.456, 2), "123.46");
  CHECK_STR(numberToFixed(-0.0001, 2), "-0.00");
  CHECK_STR(numberToFixed(-0.0, 2), "0.00");
  CHECK_STR(numberToFixed(1e21, 2), "1e+21");
  CHECK_STR(numberToPrecision(123.456, 4), "123.5");
  CHECK_STR(numberToPrecision(0.000123, 2), "0.00012");
  CHECK_STR(numberToPrecision(123456, 2), "1.2e+5");
  CHECK_STR(numberToExponential(123456, 2), "1.23e+5");
  CHECK_STR(numberToExponential(0.00015), "1.5e-4");
  // Exact binary ties round up (away from zero), unlike printf's ties-to-even.
  CHECK_STR(numberToExponential(2.5, 0), "3e+0");
  CHECK_STR(numberToExponential(-2.5, 0), "-3e+0");
  CHECK_STR(numberToExponential(8.5, 0), "9e+0");
  CHECK_STR(numberToExponential(0.125, 1), "1.3e-1");
  CHECK_STR(numberToPrecision(1.25, 2), "1.3");
  CHECK_STR(numberToPrecision(1.5, 1), "2");
  CHECK_STR(numberToPrecision(2.5, 1), "3");
  CHECK_STR(numberToPrecision(12.5, 2), "13");
  CHECK_STR(numberToPrecision(0.000125, 2), "0.00013");
  CHECK_STR(numberToPrecision(1.005, 3), "1.00");
  CHECK_STR(numberToPrecision(1.45, 2), "1.4");
  CHECK_STR(numberToPrecision(5e-324, 2), "4.9e-324");
  CHECK_STR(numberToPrecision(1e21, 3), "1.00e+21");
  CHECK(toInt32(4294967296.0 + 5) == 5);
  CHECK(toInt32(2147483648.0) == -2147483647 - 1);
  CHECK(toInt32(-1.9) == -1);
  CHECK(toInt32(kNaN) == 0);
  CHECK(toInt32(4294967295.0) == -1);
  CHECK(toInt32(2147483648.0 + 0.5) == -2147483647 - 1);
  CHECK(toInt32(-2147483649.0) == 2147483647);
  CHECK(toInt32(-4294967296.0 - 3) == -3);
  CHECK(toUint32(4294967295.9) == 4294967295u);
  CHECK(toInt32(-0.0) == 0);
  CHECK(std::signbit(jsMod(-5, 5)));
  CHECK(std::signbit(jsMod(-0.0, 3)));
  CHECK(!std::signbit(jsMod(5, -5)));
  CHECK(jsMod(-7, 3) == -1);
  CHECK(jsMod(7, -3) == 1);
  CHECK(std::isnan(jsMod(1, 0)));
  CHECK(jsMod(5.5, 2) == 1.5);
  CHECK(jsMod(-2147483648.0, -1) == 0 && std::signbit(jsMod(-2147483648.0, -1)));
  CHECK(jsMod(1e17, 7) == std::fmod(1e17, 7));
  CHECK(jsMod(-5000000000.0, 3) == -2);
  CHECK(jsMod(-6000000000.0, 3) == 0 && std::signbit(jsMod(-6000000000.0, 3)));
  CHECK(jsMod(9007199254740991.0, 1000000007) == std::fmod(9007199254740991.0, 1000000007));
  CHECK(toUint32(-1) == 4294967295u);
  CHECK(jsShr(-1, 0) == 4294967295.0);
  CHECK(jsShl(1, 31) == -2147483648.0);
  CHECK(jsSar(-8, 1) == -4);
  CHECK(math::imul(0xffffffff, 5) == -5);
  CHECK(math::clz32(1) == 31);
  CHECK(math::round(2.5) == 3);
  CHECK(math::round(-2.5) == -2);
  CHECK(std::signbit(math::round(-0.2)));
  CHECK(math::max(1, 3, 2) == 3);
  CHECK(std::isnan(math::min(1, kNaN)));
  CHECK(std::signbit(math::min(0.0, -0.0)));
  CHECK(jsMod(-5, 3) == -2);
  CHECK(std::isnan(jsPow(1, kInfinity)));
  CHECK(jsPow(kNaN, 0) == 1);
  CHECK(stringToNumber(S("  42  ")) == 42);
  CHECK(stringToNumber(S("")) == 0);
  CHECK(stringToNumber(S("0x1F")) == 31);
  CHECK(stringToNumber(S("1e3")) == 1000);
  CHECK(stringToNumber(S(".5")) == 0.5);
  CHECK(std::isnan(stringToNumber(S("12px"))));
  CHECK(std::isnan(stringToNumber(S("1e"))));
  CHECK(stringToNumber(S("-Infinity")) == -kInfinity);
  CHECK(parseInt(S("12px")) == 12);
  CHECK(parseInt(S("  -0x1A")) == -26);
  CHECK(parseInt(S("101"), 2) == 5);
  CHECK(std::isnan(parseInt(S("abc"))));
  CHECK(parseFloat(S("3.14abc")) == 3.14);
  CHECK(parseFloat(S("-.5e2x")) == -50);
  CHECK(std::isnan(parseFloat(S("x1"))));
}

/// Native 64-bit integers cross as numbers exactly, or throw: never rounded.
static void exactIntegers() {
  constexpr int64_t kMax = 9007199254740991;  // 2^53 - 1

  CHECK(exactNumber(int64_t{42}) == 42);
  CHECK(exactNumber(kMax) == 9007199254740991.0);
  CHECK(exactNumber(-kMax) == -9007199254740991.0);
  CHECK(exactNumber(uint64_t{7}) == 7);
  CHECK_THROWS(exactNumber(kMax + 1), "RangeError");
  CHECK_THROWS(exactNumber(-kMax - 1), "RangeError");
  CHECK_THROWS(exactNumber(INT64_MAX), "RangeError");
  CHECK_THROWS(exactNumber(UINT64_MAX), "RangeError");

  // Numbers to 64-bit integers as WebIDL's [EnforceRange] long long: truncated, in range.
  CHECK(toExactInteger<int64_t>(3.9) == 3);
  CHECK(toExactInteger<int64_t>(-3.9) == -3);
  CHECK(toExactInteger<int64_t>(-0.0) == 0);
  CHECK(toExactInteger<int64_t>(9007199254740991.0) == kMax);
  CHECK(toExactInteger<uint64_t>(12) == 12);
  CHECK_THROWS(toExactInteger<int64_t>(9007199254740992.0), "RangeError");
  CHECK_THROWS(toExactInteger<int64_t>(kNaN), "RangeError");
  CHECK_THROWS(toExactInteger<int64_t>(kInfinity), "RangeError");
  CHECK_THROWS(toExactInteger<uint64_t>(-1), "RangeError");
}

static void strings() {
  String s = S("Hello, Wörld 🌍");
  CHECK(s.length() == 15);
  CHECK(!s.isOneByte());
  CHECK(s.charCodeAt(7) == 'W');
  CHECK(s.charCodeAt(13) == 0xD83C);
  CHECK(std::isnan(s.charCodeAt(99)));
  CHECK(s.codePointAt(13).get() == 0x1F30D);
  CHECK_STR(s, "Hello, Wörld 🌍");
  CHECK_STR(s.slice(-2), "🌍");
  CHECK_STR(s.slice(7, 12), "Wörld");
  CHECK_STR(s.substring(12, 7), "Wörld");
  CHECK_STR(s.toUpperCase(), "HELLO, WÖRLD 🌍");
  CHECK_STR(S("ÀÉÎ ΣΑΣ Привет").toLowerCase(), "àéî σας привет");
  CHECK_STR(S("straße").toUpperCase(), "STRASSE");
  // Full Unicode case mapping, including the final sigma rule.
  CHECK_STR(S("ΟΔΟΣ").toLowerCase(), "οδος");
  CHECK_STR(S("ΣΑΣ ΣΑΣ").toLowerCase(), "σας σας");
  CHECK_STR(S("Σ").toLowerCase(), "σ");
  CHECK_STR(S("Α.Σ").toLowerCase(), "α.ς");
  CHECK_STR(S("ﬁ ŉ և ǰ ΐ").toUpperCase(), "FI \u02BCN \u0535\u0552 J\u030C \u0399\u0308\u0301");
  CHECK_STR(S("İ").toLowerCase(), "i̇");
  CHECK_STR(S("𐐨𐐩").toUpperCase(), "𐐀𐐁");
  CHECK_STR(S("ǅ").toUpperCase(), "Ǆ");
  CHECK_STR(S("ǅ").toLowerCase(), "ǆ");
  CHECK_STR(S("ⓐ").toUpperCase(), "Ⓐ");
  CHECK(S("abc").isOneByte());
  CHECK(S("café").isOneByte());
  CHECK(S("abcabc").indexOf(S("c"), 3) == 5);
  CHECK(S("abcabc").lastIndexOf(S("b")) == 4);
  CHECK(S("abc").indexOf(S("")) == 0);
  CHECK(S("abc").includes(S("bc")));
  CHECK(S("abc").startsWith(S("b"), 1));
  CHECK(S("abc").endsWith(S("ab"), 2));
  CHECK_STR(S("  x \n").trim(), "x");
  CHECK_STR(S("ab").repeat(3), "ababab");
  CHECK_THROWS(S("ab").repeat(-1), "RangeError");
  CHECK_STR(S("5").padStart(3, S("0")), "005");
  CHECK_STR(S("abc").padEnd(6, S("12")), "abc121");
  CHECK_STR(stringReplace(S("a-b-c"), S("-"), S("+")), "a+b-c");
  CHECK_STR(stringReplaceAll(S("a-b-c"), S("-"), S("+")), "a+b+c");
  CHECK_STR(stringReplaceAll(S("ab"), S(""), S("-")), "-a-b-");
  // A string pattern's replacement reads $ patterns as a RegExp's does, with no captures.
  CHECK_STR(stringReplace(S("abc"), S("b"), S("[$&]")), "a[b]c");
  CHECK_STR(stringReplace(S("abc"), S("b"), S("$$|$1|$<x>")), "a$|$1|$<x>c");
  CHECK_STR(stringReplace(S("abc"), S("b"), S("x$")), "ax$c");
  CHECK_STR(stringReplaceAll(S("aXbXc"), S("X"), S("<$`>")), "a<a>b<aXb>c");
  CHECK_STR(stringReplaceAll(S("aXbXc"), S("X"), S("<$'>")), "a<bXc>b<c>c");
  CHECK_STR(stringReplaceAll(S("ab"), S(""), S("[$&]")), "[]a[]b[]");
  CHECK(S("a") < S("b"));
  CHECK(S("Z") < S("a"));
  CHECK(S("ab") < S("abc"));
  CHECK(S("é") == String::fromUtf16(u"é"));
  CHECK_STR(stringFromCharCodes({97}), "a");
  CHECK_STR(stringFromCharCodes({97.9}), "a");
  CHECK_STR(stringFromCharCodes({65536 + 98}), "b");
  CHECK_STR(stringFromCharCodes({0xe9}), "é");
  CHECK(stringFromCharCodes({0x3a9}).charCodeAt(0) == 0x3a9);
  {
    String a = stringFromCharCodes({120});
    a += S("y");
    CHECK_STR(stringFromCharCodes({120}), "x");
  }
  CHECK(S("a").localeCompare(S("B")) < 0);
  String built;
  for (int i = 0; i < 1000; i++) built += S("x");
  CHECK(built.length() == 1000);
  String alias = built;
  built += S("y");
  CHECK(alias.length() == 1000);
  CHECK(built.length() == 1001);
  Array<String> parts = split(S("a,b,,c"), S(","));
  CHECK(parts.size() == 4);
  CHECK_STR(parts.at(2), "");
  CHECK(split(S("abc"), S("")).size() == 3);
  CHECK(split(S("a,b,c"), S(","), 2).size() == 2);
  CHECK(splitCodePoints(S("a🌍b")).size() == 3);
  CHECK_STR(String::fromCodePoint(0x1F30D), "🌍");
  CHECK(s.at(-1).get().charCodeAt(0) == 0xDF0D);
  // Lone surrogates are replaced when leaving as UTF-8.
  CHECK_STR(String::fromCodeUnit(0xD800), "\xEF\xBF\xBD");
  // Invalid UTF-8 input decodes to U+FFFD.
  CHECK(String::fromUtf8("\xff").charCodeAt(0) == 0xFFFD);
}

// How strings are stored (inline up to 15 Latin-1 units, otherwise one
// allocation) never shows: equal strings are equal and hash alike however
// they were made.
static void stringStorage() {
  const String fifteen = S("123456789012345");
  const String sixteen = S("1234567890123456");
  // Equal strings built each way: literals, concatenation, slices, UTF-16 that narrows, builders.
  String fromParts[] = {S("12345678") + S("9012345"), sixteen.slice(0, 15),
                        String::fromUtf16(u"123456789012345"), Array<String>{S("1234567"), S("89012345")}.join(S(""))};
  for (const String& s : fromParts) {
    CHECK(s == fifteen);
    CHECK(s.hash() == fifteen.hash());
  }
  String longParts[] = {fifteen + S("6"), S("12345678") + S("90123456"), String::fromUtf16(u"1234567890123456"),
                        Array<double>{1234567890123456.0}.join(S(","))};
  for (const String& s : longParts) {
    CHECK(s == sixteen);
    CHECK(s.hash() == sixteen.hash());
  }
  String grown = S("1234567890");
  grown += S("12345");
  CHECK(grown == fifteen);
  grown += S("6");
  CHECK(grown == sixteen && grown.hash() == sixteen.hash());
  // Two-byte strings: widening in place, and narrowing back where every unit fits.
  String wide = S("abcdefghijklmnopqrstuvwxyz");
  String before = wide;
  wide += S("Ω");
  CHECK(!wide.isOneByte() && before.isOneByte());
  CHECK_STR(wide, "abcdefghijklmnopqrstuvwxyzΩ");
  CHECK_STR(before, "abcdefghijklmnopqrstuvwxyz");
  CHECK(wide.slice(0, 26) == before && wide.slice(0, 26).isOneByte());
  CHECK(S("ω") + S("é") == S("ωé") && S("ωé").hash() == (S("ω") + S("é")).hash());
  CHECK(S("é") != S("ω"));
  // A shared string never grows under another handle.
  String a = sixteen;
  String b = a;
  a += S("!");
  CHECK_STR(b, "1234567890123456");
  CHECK_STR(a, "1234567890123456!");
  // appendTo: grows the place's own string in place, and appends to what was read even when
  // the right side replaced the place meanwhile, or shares the string.
  String field = sixteen + S("x");
  String read = field;
  appendTo(field, std::move(read), S("y"));
  for (int i = 0; i < 100; i++) {
    String again = field;
    appendTo(field, std::move(again), S("z"));
  }
  CHECK(field.length() == 118 && field.slice(0, 18) == sixteen + S("xy"));
  String kept = field;
  String current = field;
  appendTo(field, std::move(current), S("!"));
  CHECK(kept.length() == 118 && field.length() == 119);
  String replaced = S("old");
  String readFirst = replaced;
  replaced = S("new");
  appendTo(replaced, std::move(readFirst), S("+"));
  CHECK_STR(replaced, "old+");
  String self = sixteen;
  String selfRead = self;
  appendTo(self, std::move(selfRead), self);
  CHECK(self == sixteen + sixteen);
  // A moved-from string is the empty string, inline or not.
  String movedInline = fifteen;
  String to = std::move(movedInline);
  CHECK(movedInline.empty() && movedInline == String() && movedInline.hash() == String().hash());
  String movedHeap = sixteen;
  to = std::move(movedHeap);
  CHECK(movedHeap.empty() && movedHeap == S("") && to == sixteen);
  movedHeap += S("x");
  CHECK_STR(movedHeap, "x");
  // Builders: Latin-1 promised, then a two-byte part; exact and short results.
  StringBuilder mixed(4, true);
  mixed.append(S("ab"));
  mixed.append(S("ψ"));
  mixed.appendAscii("12");
  CHECK_STR(std::move(mixed).build(), "abψ12");
  StringBuilder none(0, true);
  CHECK(std::move(none).build().empty());
  // Single code units: Latin-1 ones inline, others two-byte.
  CHECK(String::fromCodeUnit('a') == S("a") && String::fromCodeUnit(0xE9) == S("é"));
  CHECK(String::fromCodeUnit(0x3A9) == S("Ω") && !String::fromCodeUnit(0x3A9).isOneByte());
  // Many strings in a growing vector (moved by memcpy as it grows), then read back.
  std::vector<String> many;
  for (int i = 0; i < 1000; i++) many.push_back(i % 2 ? numberToString(i) : sixteen + numberToString(i));
  CHECK_STR(many[999], "999");
  CHECK_STR(many[998], "1234567890123456998");
  // Map keys made different ways are the same key.
  Map<String, double> keys;
  keys.set(fifteen, 1);
  keys.set(fromParts[0], 2);
  keys.set(sixteen, 3);
  keys.set(longParts[1], 4);
  CHECK(keys.size() == 2 && keys.get(fifteen).get() == 2 && keys.get(sixteen).get() == 4);
}

static void indexes() {
  CHECK(indexBelow(0, 3) == 0);
  CHECK(indexBelow(-0.0, 3) == 0);
  CHECK(indexBelow(2, 3) == 2);
  CHECK(indexBelow(3, 3) == kNoIndex);
  CHECK(indexBelow(1.5, 3) == kNoIndex);
  CHECK(indexBelow(-1, 3) == kNoIndex);
  CHECK(indexBelow(kNaN, 3) == kNoIndex);
  CHECK(indexBelow(kInfinity, 3) == kNoIndex);
  CHECK(indexBelow(9007199254740992.0, SIZE_MAX) == kNoIndex);
  // Array writes: in place, at the end (appending), past it (holes are errors), not an index.
  Array<double> xs{1, 2};
  xs.set(1, 5);
  xs.set(2, 7);
  CHECK(xs.size() == 3 && xs.at(1) == 5 && xs.at(2) == 7);
  CHECK_THROWS(xs.set(5, 1), "RangeError");
  CHECK_THROWS(xs.set(0.5, 1), "RangeError");
  CHECK_THROWS(xs.set(-1, 1), "RangeError");
  // Optional elements too: undefined elements are not holes.
  Array<Opt<double>> holes;
  CHECK_THROWS(holes.set(2, 1.0), "RangeError");
  CHECK(holes.size() == 0);
  CHECK(xs.get(1.0).get() == 5 && !xs.get(1.5).has() && !xs.get(3).has());
  CHECK(S("abc").charCodeAt(1.9) == 'b');
  CHECK(S("abc").charCodeAt(-0.5) == 'a');
  CHECK(std::isnan(S("abc").charCodeAt(-1)));
  CHECK(S("abc").charCodeAt(kNaN) == 'a');
  // ToInt32: one branch for every value int64 holds.
  CHECK(toInt32(9.2e18) == toInt32(9.2e18 - 4294967296.0 * 2097152));
  CHECK(toInt32(-9223372036854775808.0) == 0);
  CHECK(toInt32(9223372036854775808.0) == 0);
  CHECK(toInt32(1e20) == 1661992960);
  CHECK(toInt32(-kInfinity) == 0);
}

static void arrays() {
  Array<double> a{3, 1, 2};
  Array<double> alias = a;
  alias.push(10);
  CHECK(a.size() == 4);
  CHECK_STR(a.join(), "3,1,2,10");
  a.sort();
  CHECK_STR(a.join(), "1,10,2,3");  // default sort compares strings
  a.sort([](double x, double y) { return x - y; });
  CHECK_STR(a.join(S("|")), "1|2|3|10");
  CHECK(a.get(99).isUndefined());
  CHECK(a.getIndex(int64_t{1}).get() == 2);
  CHECK(a.getIndex(int64_t{-1}).isUndefined());
  CHECK(a.getIndex(int64_t{1} << 40).isUndefined());
  CHECK(a.get(1).get() == 2);
  // Integer elements (a table the compiler proved holds only integers): the numbers they read as.
  Array<uint32_t> table{0, 4294967295u};
  table.push(7);
  CHECK(numberOf(table.getIndex(int64_t{1})).get() == 4294967295.0);
  CHECK(numberOf(table.get(2)).get() == 7);
  CHECK(numberOf(table.get(1.5)).isUndefined());
  CHECK(numberOf(table.getIndex(int64_t{3})).isUndefined());
  CHECK(!std::signbit(numberOf(table.getIndex(int64_t{0})).get()));
  CHECK_THROWS(table.getIndex(int64_t{-1}).value(), "TypeError");
  setElement(table, 0, uint32_t{9});
  CHECK(table.at(0) == 9 && table.length() == 3);
  CHECK_THROWS(a.set(10, 5), "RangeError");
  a.set(4, 11);
  CHECK(a.size() == 5);
  auto doubled = a.map<double>([](double v) { return v * 2; });
  CHECK_STR(doubled.join(), "2,4,6,20,22");
  auto withIndex = a.map<double>([](double v, double i) { return v + i; });
  CHECK_STR(withIndex.join(), "1,3,5,13,15");
  CHECK(a.filter([](double v) { return v > 2; }).size() == 3);
  CHECK(a.reduce([](double acc, double v) { return acc + v; }, 0.0) == 27);
  CHECK(a.reduce([](double acc, double v) { return acc + v; }) == 27);
  CHECK(a.find([](double v) { return v > 2; }).get() == 3);
  CHECK(a.findIndex([](double v) { return v > 100; }) == -1);
  CHECK(a.some([](double v) { return v == 10; }));
  CHECK(!a.every([](double v) { return v < 10; }));
  CHECK(a.indexOf(10) == 3);
  Array<double> nans{kNaN};
  CHECK(nans.includes(kNaN));
  CHECK(nans.indexOf(kNaN) == -1);
  CHECK_STR(a.slice(1, -1).join(), "2,3,10");
  auto removed = a.splice(1, 2, 7.0, 8.0, 9.0);
  CHECK_STR(removed.join(), "2,3");
  CHECK_STR(a.join(), "1,7,8,9,10,11");
  CHECK(a.pop().get() == 11);
  CHECK(a.shift().get() == 1);
  CHECK(a.unshift(0) == 5);
  a.reverse();
  CHECK_STR(a.join(), "10,9,8,7,0");
  CHECK(Array<double>().pop().isUndefined());
  CHECK_THROWS(Array<double>().reduce([](double x, double y) { return x + y; }), "TypeError");
  Array<bool> flags{true, false};
  CHECK_STR(flags.join(), "true,false");
  Array<Opt<double>> opts{Opt<double>(1.0), Opt<double>(undefined), Opt<double>(null)};
  CHECK_STR(opts.join(S("-")), "1--");
  // Growing past the end would make holes, which no element type holds:
  // undefined elements are not holes (forEach visits them, indexOf finds them).
  CHECK_THROWS(opts.set(5, Opt<double>(2.0)), "RangeError");
  CHECK_THROWS(opts.setLength(4), "RangeError");
  CHECK_THROWS(a.setLength(10), "RangeError");
  CHECK(opts.size() == 3);
  opts.set(3, Opt<double>(2.0));
  opts.setLength(1);
  CHECK_STR(opts.join(S("-")), "1");
  // Stable sort
  Array<String> words{S("bb"), S("a"), S("cc"), S("d")};
  words.sort([](const String& x, const String& y) { return static_cast<double>(x.length()) - static_cast<double>(y.length()); });
  CHECK_STR(words.join(), "a,d,bb,cc");
  // Mutation during forEach sees the initial length.
  Array<double> grow{1, 2};
  double visits = 0;
  grow.forEach([&](double) {
    visits++;
    grow.push(0);
  });
  CHECK(visits == 2);
  auto gen = Array<double>::generate(4, [](double i) { return i * i; });
  CHECK_STR(gen.join(), "0,1,4,9");
  // Array.from's length is ToLength's: truncated, 0 when negative or NaN.
  auto index = [](double i) { return i; };
  CHECK(Array<double>::generate(2.5, index).size() == 2);
  CHECK(Array<double>::generate(-1, index).size() == 0);
  CHECK(Array<double>::generate(kNaN, index).size() == 0);
  CHECK_THROWS(Array<double>::generate(4294967296.0, index), "RangeError");
  CHECK(arrayLikeLength(-1) == 0);
  CHECK(arrayLikeLength(2.5) == 2);
  // new Array(n)'s is ArrayCreate's: an integer from 0 to 2^32 - 1.
  CHECK(arrayLength(3) == 3);
  CHECK(arrayLength(4294967295.0) == 4294967295u);
  CHECK_THROWS(arrayLength(-1), "RangeError");
  CHECK_THROWS(arrayLength(1.5), "RangeError");
  CHECK_THROWS(arrayLength(kNaN), "RangeError");
  CHECK_THROWS(arrayLength(4294967296.0), "RangeError");
  Array<Array<double>> nested{Array<double>{1}, Array<double>{2, 3}};
  auto flat = nested.flatMap<double>([](const Array<double>& x) { return x; });
  CHECK_STR(flat.join(), "1,2,3");
}

static void maps() {
  Map<String, double> m;
  m.set(S("b"), 2).set(S("a"), 1);
  m.set(S("b"), 3);
  CHECK(m.size() == 2);
  CHECK(m.get(S("b")).get() == 3);
  CHECK(m.get(S("zz")).isUndefined());
  CHECK_STR(m.keys().join(), "b,a");
  m.remove(S("b"));
  m.set(S("b"), 4);
  CHECK_STR(m.keys().join(), "a,b");
  Map<double, String> nm;
  nm.set(kNaN, S("nan"));
  nm.set(-0.0, S("zero"));
  CHECK(nm.get(kNaN).get() == S("nan"));
  CHECK(nm.get(0.0).get() == S("zero"));
  // Deleting and adding during iteration behaves like JS.
  Map<double, double> it;
  for (int i = 0; i < 40; i++) it.set(i, i);
  double seen = 0;
  it.forEach([&](double v, double k) {
    seen++;
    if (k < 20) it.remove(k + 20);
    (void)v;
  });
  CHECK(seen == 20);
  Set<String> set;
  set.add(S("x")).add(S("y")).add(S("x"));
  CHECK(set.size() == 2);
  CHECK(set.has(S("y")));
  Dict<double> d;
  d.set(S("b"), 1);
  d.set(S("10"), 2);
  d.set(S("2"), 3);
  d.set(S("a"), 4);
  CHECK_STR(d.keys().join(), "2,10,b,a");
  CHECK_STR(d.values().join(), "3,2,1,4");
  struct Node : Object {
    double v = 0;
  };
  Map<Ref<Node>, double> byRef;
  auto n1 = std::make_shared<Node>();
  auto n2 = std::make_shared<Node>();
  byRef.set(n1, 1).set(n2, 2);
  CHECK(byRef.get(n2).get() == 2);
}

static void optionalsAndUnions() {
  Opt<double> u;
  Opt<double> n = null;
  Opt<double> v = 3.0;
  CHECK(strictEquals(u, undefined));
  CHECK(!strictEquals(n, undefined));
  CHECK(strictEquals(n, null));
  CHECK(strictEquals(v, 3.0));
  CHECK(!strictEquals(u, n));
  CHECK_THROWS(u.value(), "TypeError");
  CHECK(!truthy(Opt<double>(0.0)));
  CHECK(truthy(Opt<String>(S("x"))));
  Union<double, String> x = S("hi");
  CHECK_STR(typeOf(x), "string");
  CHECK_STR(toJsString(x), "hi");
  CHECK(strictEquals(x, S("hi")));
  auto asStr = convert<String>(x);
  CHECK_STR(asStr, "hi");
  CHECK_THROWS(convert<double>(x), "TypeError");
  Union<double, String, bool> wide = convert<Union<double, String, bool>>(x);
  CHECK(std::holds_alternative<String>(wide));
  Opt<Union<double, String>> maybe = convert<Opt<Union<double, String>>>(2.0);
  CHECK(maybe.has());
  CHECK_STR(typeOf(Opt<double>(null)), "object");

  // An optional narrowed to `null | undefined` stays the one it holds.
  for (const Opt<String>& absent : {Opt<String>(null), Opt<String>(undefined)}) {
    Opt<Undefined> narrowed = convert<Opt<Undefined>>(absent);
    CHECK(narrowed.isNull() == absent.isNull() && narrowed.isUndefined() == absent.isUndefined());
  }

  // A read of a collection of optionals: one level of absence, null kept.
  Array<Opt<double>> xs{Opt<double>(1.0), Opt<double>(undefined), Opt<double>(null)};
  Opt<double> first = flat(xs.get(0));
  CHECK(first.has() && first.get() == 1.0);
  CHECK(flat(xs.get(1)).isUndefined());
  CHECK(flat(xs.get(2)).isNull());
  CHECK(flat(xs.get(9)).isUndefined());
  Map<String, Opt<String>> m;
  m.set(S("n"), Opt<String>(null));
  CHECK(flat(m.get(S("n"))).isNull());
  CHECK(flat(m.get(S("x"))).isUndefined());

  // An optional object, or union holding one, in storage of its own (a
  // promise's value): its traits are asked while the optional of it is
  // being made.
  std::optional<Opt<Ref<Object>>> stored;
  std::optional<Opt<Union<Ref<Object>, double>>> storedUnion;
  Promise<Opt<Ref<Object>>> pending;
  stored.emplace(std::make_shared<Object>());
  CHECK(stored->has() && !storedUnion.has_value() && !pending.settled());
  Array<Opt<Ref<Object>>> objects{Opt<Ref<Object>>(null)};
  CHECK(flat(objects.get(0)).isNull() && flat(objects.get(1)).isUndefined());
}

/// Two objects that reach each other, one of them weakly (a delegate's owner).
struct Owner : Object {
  Ref<Object> delegate;
};
struct Delegate : Object {
  Ref<WeakRefObject<Ref<Owner>>> owner;
};

static void weakReferences() {
  auto owner = std::make_shared<Owner>();
  auto delegate = std::make_shared<Delegate>();
  owner->delegate = delegate;
  delegate->owner = std::make_shared<WeakRefObject<Ref<Owner>>>(owner);

  // deref() gives the target while something holds it.
  CHECK(delegate->owner->deref().has() && delegate->owner->deref().value() == owner);
  CHECK(strictEquals(delegate->owner, delegate->owner));

  // The cycle frees with its last strong reference, and deref() then gives undefined.
  std::weak_ptr<Owner> watched = owner;
  std::weak_ptr<Delegate> watchedDelegate = delegate;
  auto weak = delegate->owner;
  owner.reset();
  delegate.reset();
  CHECK(watched.expired() && watchedDelegate.expired());
  CHECK(weak->deref().isUndefined());
}

/// A weak collection's key, an interface one implements, and a value that holds a key.
struct Key : Object {};
struct Shape {
  virtual ~Shape() = default;
  virtual double area() const = 0;
};
struct Square : Object, virtual Shape {
  double area() const override { return 4; }
};

static void weakCollections() {
  WeakMap<Ref<Key>, Ref<Owner>> owners;
  WeakSet<Ref<Key>> seen;
  auto a = std::make_shared<Key>();
  auto b = std::make_shared<Key>();
  auto value = std::make_shared<Owner>();
  std::weak_ptr<Owner> watched = value;

  owners.set(a, value);
  value.reset();
  seen.add(a).add(b);
  CHECK(owners.has(a) && !owners.has(b) && owners.get(a).has() && owners.get(b).isUndefined());
  CHECK(seen.has(a) && seen.has(b));

  // The key's last reference drops its entries at once, the value with them.
  std::weak_ptr<Key> watchedKey = a;
  a.reset();
  CHECK(watchedKey.expired() && watched.expired());
  CHECK(seen.has(b));

  // Removed, a key is no longer there; added again, it is, once.
  CHECK(seen.remove(b) && !seen.remove(b) && !seen.has(b));
  seen.add(b).add(b);
  CHECK(seen.has(b));

  // A value that holds another key of the same map: freeing the first key
  // frees the value, which frees the second key, which drops its entry.
  auto first = std::make_shared<Key>();
  auto second = std::make_shared<Key>();
  auto holder = std::make_shared<Owner>();
  holder->delegate = second;
  owners.set(first, holder);
  owners.set(second, std::make_shared<Owner>());
  holder.reset();
  std::weak_ptr<Key> watchedSecond = second;
  second.reset();
  CHECK(!watchedSecond.expired());
  first.reset();
  CHECK(watchedSecond.expired());

  // Replacing a value frees the old one.
  auto c = std::make_shared<Key>();
  auto old = std::make_shared<Owner>();
  std::weak_ptr<Owner> watchedOld = old;
  owners.set(c, old);
  old.reset();
  owners.set(c, std::make_shared<Owner>());
  CHECK(watchedOld.expired() && owners.has(c));

  // A collection freed first: its keys live on, and are freed without it.
  {
    WeakMap<Ref<Key>, double> gone;
    gone.set(b, 1);
    gone.set(c, 2);
  }
  b.reset();
  c.reset();

  // An interface value and the object behind it are one key.
  auto square = std::make_shared<Square>();
  Ref<Shape> shape = square;
  WeakMap<Ref<Shape>, double> areas;
  WeakSet<Ref<Square>> squares;
  areas.set(shape, 4);
  squares.add(square);
  CHECK(areas.get(shape).has() && areas.get(shape).value() == 4);
  std::weak_ptr<Square> watchedSquare = square;
  square.reset();
  CHECK(!watchedSquare.expired() && areas.has(shape));
  shape.reset();
  CHECK(watchedSquare.expired());

  // A copy of a key is another object, no collection's key.
  auto original = std::make_shared<Key>();
  seen.add(original);
  {
    auto copy = std::make_shared<Key>(*original);
    CHECK(!seen.has(copy));
  }
  CHECK(seen.has(original));

  // Copies of a collection share its entries, and are the same collection.
  WeakSet<Ref<Key>> alias = seen;
  CHECK(alias.has(original) && strictEquals(alias, seen) && !strictEquals(seen, WeakSet<Ref<Key>>()));
  CHECK(toJsString(owners).toUtf8() == "[object WeakMap]" && toJsString(seen).toUtf8() == "[object WeakSet]");
}

/// Runs `f` as a turn of `context` and waits for it.
template <class F>
static void inTurn(ExecutionContext& context, F f) {
  std::promise<void> done;
  auto future = done.get_future();
  context.post([&] {
    f();
    done.set_value();
  });
  if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    std::fprintf(stderr, "a turn did not run within 5 s\n");
    std::abort();
  }
}

/// A FinalizationRegistry's cleanup runs once a target is gone, as a job
/// of the context that made the registry, after the turn that freed it;
/// an unregistered target's never runs, nor a freed registry's.
static void finalizationRegistries() {
  auto context = IsolatedContext::create();
  std::vector<std::string> cleaned;
  Opt<FinalizationRegistry<String>> registry;
  auto key = std::make_shared<Key>();
  auto kept = std::make_shared<Key>();
  auto token = std::make_shared<Key>();
  std::string sawDuring;

  inTurn(*context, [&] {
    registry = FinalizationRegistry<String>(Fn<void(String)>([&](String held) { cleaned.push_back(held.toUtf8()); }));
    registry.get().registerTarget(key, S("first"));
    registry.get().registerTarget(key, S("again"));
    registry.get().registerTarget(kept, S("kept"), token);
    key.reset();
    // Not during the turn that freed the target: a job after it.
    sawDuring = std::to_string(cleaned.size());
  });
  inTurn(*context, [] {});
  CHECK(sawDuring == "0");
  CHECK((cleaned == std::vector<std::string>{"first", "again"}));

  // Unregistered, a target goes without a cleanup; unregister says whether it removed any.
  bool removed = false, again = true;
  inTurn(*context, [&] {
    removed = registry.get().unregister(token);
    again = registry.get().unregister(token);
    kept.reset();
  });
  inTurn(*context, [] {});
  CHECK(removed && !again);
  CHECK(cleaned.size() == 2);

  // A target that is its own held value is a TypeError, as in JavaScript.
  auto self = std::make_shared<Key>();
  FinalizationRegistry<Ref<Key>> owners(Fn<void(Ref<Key>)>([](Ref<Key>) {}));
  CHECK_THROWS(owners.registerTarget(self, self), "TypeError");

  // A cycle through a WeakRef keeps neither: a parent holding its child,
  // which refers back weakly, goes with its last outside reference, and so
  // does the child; both cleanups run.
  struct Child : Object {
    Ref<WeakRefObject<Ref<Object>>> parent;
  };
  struct Parent : Object {
    Ref<Child> child = std::make_shared<Child>();
  };
  auto parent = std::make_shared<Parent>();
  parent->child->parent = std::make_shared<WeakRefObject<Ref<Object>>>(parent);
  inTurn(*context, [&] {
    registry.get().registerTarget(parent, S("parent"));
    registry.get().registerTarget(parent->child, S("child"));
    parent.reset();
  });
  inTurn(*context, [] {});
  CHECK(cleaned.size() == 4);
  CHECK((std::set<std::string>(cleaned.begin() + 2, cleaned.end()) == std::set<std::string>{"parent", "child"}));

  // A registry freed before its target: no cleanup.
  auto late = std::make_shared<Key>();
  inTurn(*context, [&] {
    registry.get().registerTarget(late, S("late"));
    registry = undefined;
    late.reset();
  });
  inTurn(*context, [] {});
  CHECK(cleaned.size() == 4);

  context->shutdown();
}

// Generated code calls lucent::strictEquals qualified, which finds no
// hidden friend: every overload has to be declared at namespace scope.
static void qualifiedStrictEquals() {
  Array<double> a{1, 2};
  Array<double> sameContents{1, 2};
  CHECK(lucent::strictEquals(a, Array<double>(a)) && !lucent::strictEquals(a, sameContents));

  Map<String, double> m;
  CHECK(lucent::strictEquals(m, m.set(S("k"), 1)) && !lucent::strictEquals(m, Map<String, double>()));

  Set<double> s;
  CHECK(lucent::strictEquals(s, s.add(1)) && !lucent::strictEquals(s, Set<double>()));

  Dict<double> d;
  Dict<double> alias = d;
  CHECK(lucent::strictEquals(d, alias) && !lucent::strictEquals(d, Dict<double>()));

  Bytes b = Bytes::fromArray(Array<double>{1, 2, 3});
  CHECK(lucent::strictEquals(b, Bytes(b)) && !lucent::strictEquals(b, b.subarray(1)) && !lucent::strictEquals(b, b.slice()));

  CHECK(lucent::strictEquals(BigInt::fromInt64(7), BigInt::fromInt64(7)) && !lucent::strictEquals(BigInt::fromInt64(7), BigInt()));
}

// String(x) in generated code is a qualified lucent::toJsString call too.
static void qualifiedToJsString() {
  CHECK_STR(lucent::toJsString(Array<double>{1, 2}), "1,2");
  CHECK_STR(lucent::toJsString(Map<String, double>()), "[object Map]");
  CHECK_STR(lucent::toJsString(Set<double>()), "[object Set]");
  CHECK_STR(lucent::toJsString(Dict<double>()), "[object Object]");
  CHECK_STR(lucent::toJsString(Bytes::fromArray(Array<double>{1, 255})), "1,255");

  AbortController c = std::make_shared<AbortControllerObject>();
  CHECK_STR(lucent::toJsString(c), "[object AbortController]");
  CHECK_STR(lucent::toJsString(c->signal), "[object AbortSignal]");
}

// Operands of different C++ types: those no JavaScript value can be both
// of are never ===; optionals, unions and class instances compare what
// they hold, so they never take that shortcut.
struct Base : Object {};
struct Derived : Base {};
struct Other : Object {};

static_assert(Disjoint<double, BigInt> && Disjoint<Undefined, Null> && Disjoint<Array<double>, Undefined>);
static_assert(Disjoint<Array<String>, double> && Disjoint<bool, double> && Disjoint<Array<double>, Array<String>>);
static_assert(!Disjoint<Opt<double>, Opt<String>> && !Disjoint<Opt<double>, Undefined> && !Disjoint<Opt<double>, double>);
static_assert(!Disjoint<Union<double, String>, Union<bool, String>> && !Disjoint<Union<double, String>, double>);
static_assert(!Disjoint<Ref<Base>, Ref<Derived>> && !Disjoint<Ref<Derived>, Ref<Other>> && !Disjoint<double, int64_t>);
static_assert(!Disjoint<std::tuple<double>, std::tuple<Opt<double>>>);

static void mixedStrictEquals() {
  CHECK(!strictEquals(1.0, BigInt::fromInt64(1)) && !strictEquals(null, undefined) && !strictEquals(Array<double>{0}, 0.0));
  CHECK(!strictEquals(Array<double>{}, undefined) && !strictEquals(true, 1.0) && strictEquals(int64_t(2), 2.0));

  CHECK(strictEquals(Opt<double>(), Opt<String>()) && !strictEquals(Opt<double>(), Opt<String>(null)));
  CHECK(!strictEquals(Opt<double>(1.0), Opt<String>(S("1"))) && strictEquals(Opt<double>(1.0), 1.0));

  Union<double, String> number = 1.0, text = S("a");
  Union<bool, String> other = S("a");
  CHECK(strictEquals(text, other) && !strictEquals(number, other) && strictEquals(1.0, number) && !strictEquals(number, S("1")));

  auto d = std::make_shared<Derived>();
  Ref<Base> b = d;
  CHECK(strictEquals(b, d) && !strictEquals(d, std::make_shared<Other>()));

  CHECK(strictEquals(std::tuple<double, String>(1, S("a")), std::tuple<Opt<double>, String>(1.0, S("a"))));

  CHECK(looseEquals(Opt<double>(), Opt<double>(null)) && looseEqualsNull(undefined) && !looseEqualsNull(Array<double>{}));
  CHECK(sameValueZero(Union<double, String>(NAN), Union<double, String>(NAN)) && sameValueZero(Opt<double>(NAN), NAN));
}

// Object-typed storage holds a null Ref until something writes it (a field
// a base constructor reads, a module variable before its initializer):
// reading it throws TypeError, as using JavaScript's undefined does.
static void unassignedStorage() {
  Ref<Base> none;
  auto some = std::make_shared<Base>();
  CHECK_THROWS(assigned(none, "Sub.opts"), "TypeError");
  CHECK(assigned(some, "Sub.opts") == some);

  Union<Ref<Base>, Ref<Other>> noneOfEither;
  Union<Ref<Base>, Ref<Other>> other = std::make_shared<Other>();
  CHECK_THROWS(assigned(noneOfEither, "Sub.shape"), "TypeError");
  CHECK(std::holds_alternative<Ref<Other>>(assigned(other, "Sub.shape")));

  CHECK(assigned(2.0, "count") == 2.0);
}

/// A `let` or `const` code may use before its declaration runs throws
/// ReferenceError until then: a local's box, and a module variable's flag.
static void temporalDeadZone() {
  Box<double> early(tdz, "count");
  Box<double> copy = early;  // a closure's capture shares the box
  CHECK_THROWS(*copy, "ReferenceError");
  CHECK_THROWS(*copy = 1, "ReferenceError");
  try {
    (void)*early;
  } catch (const Exception& e) {
    CHECK_STR(e.error()->message, "Cannot access 'count' before initialization");
  }
  early.init(2);
  CHECK(*copy == 2);
  *copy = 3;
  CHECK(*early == 3);

  Box<double> plain(4);
  CHECK(*plain == 4);

  bool declared = false;
  String label;
  CHECK_THROWS(lucent::declared(declared, "label", label), "ReferenceError");
  initialize(declared, label, S("ready"));
  CHECK_STR(lucent::declared(declared, "label", label), "ready");
  lucent::declared(declared, "label", label) = S("set");
  CHECK_STR(label, "set");
}

static void errors() {
  try {
    throwError(S("TypeError"), S("bad"));
  } catch (const Exception& e) {
    CHECK_STR(errorToString(e.error()), "TypeError: bad");
  }
  Error e = currentError(std::make_exception_ptr(std::runtime_error("boom")));
  CHECK_STR(e->message, "boom");
  // A disposal that throws while an error is pending: both, in a SuppressedError.
  auto closing = std::make_exception_ptr(Exception(makeError(S("cannot close"))));
  auto pending = std::make_exception_ptr(Exception(makeError(S("boom"))));
  Error s = currentError(suppressedError(closing, pending));
  CHECK_STR(errorToString(s), "SuppressedError: An error was suppressed during disposal.");
  auto both = std::dynamic_pointer_cast<SuppressedErrorObject>(s);
  CHECK(both != nullptr);
  CHECK_STR(both->error->message, "cannot close");
  CHECK_STR(both->suppressed->message, "boom");
}

static Promise<double> addLater(double a, double b) {
  co_await delay(5);
  co_return a + b;
}

static Promise<double> sumAll(Array<double> xs) {
  Array<Promise<double>> ps;
  for (double x : xs.items()) ps.push(addLater(x, 1));
  Array<double> r = co_await promiseAll(ps);
  co_return r.reduce([](double acc, double v) { return acc + v; }, 0.0);
}

static Promise<void> failing() {
  co_await delay(1);
  throwError(S("Error"), S("nope"));
}

static Promise<String> catches() {
  try {
    co_await failing();
  } catch (const Exception& e) {
    co_return e.error()->message;
  }
  co_return S("unreachable");
}

// Captures must be coroutine parameters, never lambda captures: the lambda
// object may be gone before the coroutine resumes.
static Promise<void> orderTask(std::string* order) {
  *order += "a";
  co_await Promise<double>::resolved(1);
  *order += "c";
}

static void async() {
  // Ordering: the body runs synchronously until the first await, and an
  // await on a settled promise still yields.
  std::string order;
  {
    LucentScope scope;
    orderTask(&order);
    order += "b";
  }
  Actor::shared().waitIdle(1000);
  CHECK(order == "abc");

  Promise<double> total;
  Promise<String> caught;
  {
    LucentScope scope;
    total = sumAll(Array<double>{1, 2, 3});
    caught = catches();
  }
  for (int i = 0; i < 100 && !(total.settled() && caught.settled()); i++) Actor::shared().waitIdle(50);
  {
    LucentScope scope;
    CHECK(total.fulfilled());
    CHECK(total.value() == 9);
    CHECK(caught.fulfilled());
    CHECK_STR(caught.value(), "nope");
  }
}

// `return p` from a coroutine: the frame ends there, and its promise adopts
// p a thenable job and p's reaction later.
static Promise<double> adopting(Promise<double> p, std::string* order) {
  co_await later(0.0);
  *order += "r";
  co_return co_await adopt<double>(p);
}

static Promise<void> adoptingNothing(Promise<void> p) {
  co_await later(undefined);
  co_return co_await adopt<void>(p);
}

static void promiseCombinators() {
  std::string order;
  Promise<double> adopted, eager, raced, anyOf, converted;
  Promise<void> nothing;
  Promise<Array<String>> settled;
  {
    LucentScope scope;
    Promise<double> one = Promise<double>::resolved(1);
    adopted = adopting(one, &order);
    promiseThen<double>(one, [&order](double) {
      order += "1";
      return 0.0;
    });
    eager = adoptedPromise<double>(Promise<double>::rejected(makeError(S("no"))));
    converted = adoptedPromise<double>(Promise<String>::resolved(S("abc")), [](const String& x) { return double(x.length()); });
    nothing = adoptingNothing(Promise<void>::resolved());
    raced = promiseRaceTuple<double>(std::make_tuple(Promise<double>(), Promise<double>::resolved(2)), asIs, asIs);
    anyOf = promiseAny(Array<Promise<double>>{Promise<double>::rejected(makeError(S("a"))),
                                              Promise<double>::rejected(makeError(S("b")))});
    settled = promiseAllSettled<String>(Array<Promise<double>>{one, Promise<double>::rejected(makeError(S("c")))},
                                        [](double) { return S("ok"); }, [](Error e) { return e->message; });
  }
  Actor::shared().waitIdle(1000);

  LucentScope scope;
  // The coroutine resumed from its await before one's reaction ran.
  CHECK(order == "r1");
  CHECK(adopted.fulfilled() && adopted.value() == 1);
  CHECK(!eager.fulfilled() && eager.settled());
  CHECK_STR(eager.error()->message, "no");
  CHECK(converted.fulfilled() && converted.value() == 3);
  CHECK(nothing.fulfilled());
  CHECK(raced.fulfilled() && raced.value() == 2);
  CHECK(anyOf.settled() && !anyOf.fulfilled());
  CHECK_STR(anyOf.error()->name, "AggregateError");
  Array<Error> reasons = aggregateErrors(anyOf.error());
  CHECK(reasons.size() == 2);
  CHECK_STR(reasons.items()[1]->message, "b");
  CHECK(settled.fulfilled() && settled.value().size() == 2);
  CHECK_STR(settled.value().items()[0], "ok");
  CHECK_STR(settled.value().items()[1], "c");
}

// The Lucent thread sleeps until the earliest timer while other threads add
// timers; growing the timer heap must not invalidate the deadline it waits on.
static void timersPostedWhileWaiting() {
  std::atomic<int> fired{0};
  Actor& s = Actor::shared();
  s.postDelayed(30, [&] { fired++; });
  std::this_thread::sleep_for(std::chrono::milliseconds(5));
  for (int i = 0; i < 256; i++) s.postDelayed(40, [&] { fired++; });
  s.waitIdle(2000);
  CHECK(fired == 257);
}

static Promise<String> waitFor(double ms, AbortSignal signal) {
  try {
    co_await delay(ms, signal);
    co_return S("finished");
  } catch (const Exception& e) {
    co_return e.error()->name;
  }
}

static void abortSignals() {
  std::string log;
  Promise<String> early;
  Promise<String> late;
  AbortController c = std::make_shared<AbortControllerObject>();
  {
    LucentScope scope;
    c->signal->addEventListener([&] { log += "listener "; });
    early = waitFor(1000, c->signal);
    CHECK(!c->signal->aborted);
    c->abort(undefined);
    c->abort(undefined);
    CHECK(c->signal->aborted);
    CHECK_STR(c->signal->reason->name, "AbortError");
    CHECK_STR(c->signal->reason->message, "signal is aborted without reason");
    CHECK_THROWS(c->signal->throwIfAborted(), "AbortError");
    late = waitFor(1, c->signal);
  }
  Actor::shared().waitIdle(2000);
  {
    LucentScope scope;
    CHECK(log == "listener ");
    CHECK_STR(early.value(), "AbortError");
    CHECK_STR(late.value(), "AbortError");
  }

  Promise<String> finished;
  AbortController quiet = std::make_shared<AbortControllerObject>();
  {
    LucentScope scope;
    finished = waitFor(1, quiet->signal);
  }
  Actor::shared().waitIdle(2000);
  {
    LucentScope scope;
    CHECK_STR(finished.value(), "finished");
    quiet->abort(makeError(S("stop")));
    CHECK_STR(quiet->signal->reason->message, "stop");
  }
}

static void dates() {
  // Local-time rules need a zone with daylight saving time.
  setenv("TZ", "America/New_York", 1);
  tzset();
  CHECK(dateUTC(2024, 1, 29, 13, 45, 30, 123) == 1709214330123.0);
  CHECK_STR(makeDate(1709214330123.0)->toISOString(), "2024-02-29T13:45:30.123Z");
  CHECK(dateParse(S("2024-02-29T13:45:30+02:00")) == 1709207130000.0);
  CHECK(dateParse(S("Mon Jul 22 2019 15:51:50 GMT-0700")) == 1563835910000.0);
  // A local time in the spring-forward gap uses the offset before the
  // transition; one that happens twice in the fall-back overlap, the earlier.
  CHECK_STR(dateFromLocal(2024, 2, 10, 2, 30, 0, 0)->toISOString(), "2024-03-10T07:30:00.000Z");
  CHECK(dateFromLocal(2024, 2, 10, 2, 30, 0, 0)->getHours() == 3);
  CHECK_STR(dateFromLocal(2024, 10, 3, 1, 30, 0, 0)->toISOString(), "2024-11-03T05:30:00.000Z");
  // Hermes's format: no zone name.
  CHECK_STR(makeDate(1563835910000.0)->toString(), "Mon Jul 22 2019 18:51:50 GMT-0400");
  CHECK_STR(makeDate(1563835910000.0)->toUTCString(), "Mon, 22 Jul 2019 22:51:50 GMT");
  CHECK(std::isnan(makeDate(8.64e15 + 1)->getTime()));
  CHECK_STR(makeDate(kNaN)->toString(), "Invalid Date");
  CHECK_THROWS(makeDate(kNaN)->toISOString(), "RangeError");
}

static Iter<double> counter(double n, std::string* log) {
  try {
    for (double i = 0; i < n; i++) co_yield i;
  } catch (...) {
    *log += "finally ";
    throw;
  }
  *log += "end ";
}

static Iter<double> failingGen() {
  co_yield 1;
  throwError(S("Error"), S("boom"));
}

static void generators() {
  std::string log;
  Iter<double> g = counter(3, &log);
  CHECK(log.empty());  // lazy
  CHECK(*g->next() == 0);
  CHECK(*g->next() == 1);
  CHECK(*g->next() == 2);
  CHECK(!g->next());
  CHECK(log == "end ");
  CHECK(!g->next());

  log.clear();
  Iter<double> h = counter(3, &log);
  CHECK(*h->next() == 0);
  h->ret();  // runs the finally path, not the normal end
  CHECK(log == "finally ");
  CHECK(!h->next());

  log.clear();
  Iter<double> unstarted = counter(3, &log);
  unstarted->ret();
  CHECK(log.empty());
  CHECK(!unstarted->next());

  Iter<double> f = failingGen();
  CHECK(*f->next() == 1);
  CHECK_THROWS(f->next(), "Error");
  CHECK(!f->next());

  CHECK_STR(iterToArray(iterOf(Array<double>{1, 2})).join(), "1,2");
  CHECK_STR(iterToArray(iterOf(S("a🌍"))).join(S("|")), "a|🌍");

  log.clear();
  {
    Iter<double> c = counter(5, &log);
    IterCloser<double> closer(c);
    c->next();
  }
  CHECK(log == "finally ");
}

static void bytes() {
  Bytes b = Bytes::fromArray(Array<double>{1, 2, 300, -1});
  CHECK_STR(b.join(), "1,2,44,255");
  Bytes view = b.subarray(1, 3);
  view.set(0, 9);
  CHECK(b.at(1) == 9);
  Bytes copy = b.slice(1, 3);
  copy.set(0, 7);
  CHECK(b.at(1) == 9);
  CHECK_STR(utf8Decode(utf8Encode(S("héllo 🌍"))), "héllo 🌍");
  CHECK(utf8Encode(S("é")).size() == 2);
}

/// The typed arrays besides Uint8Array: JavaScript's conversions on write,
/// views at an aligned byte offset, sharing and copying, the methods
/// %TypedArray% has, and DataView's byte orders.
static void typedArrays() {
  CHECK_STR(Int8Array::fromArray(Array<double>{127, 128, -129, 255.9, NAN}).join(), "127,-128,127,-1,0");
  CHECK_STR(Uint8ClampedArray::fromArray(Array<double>{-5, 0.5, 1.5, 2.5, 254.5, 300, NAN}).join(), "0,0,2,2,254,255,0");
  CHECK_STR(Int16Array::fromArray(Array<double>{32768, -32769}).join(), "-32768,32767");
  CHECK_STR(Uint16Array::fromArray(Array<double>{-1, 65536}).join(), "65535,0");
  CHECK_STR(Int32Array::fromArray(Array<double>{2147483648.0, -1.5}).join(), "-2147483648,-1");
  CHECK_STR(Uint32Array::fromArray(Array<double>{-1, 4294967296.0}).join(), "4294967295,0");
  CHECK_STR(Float32Array::fromArray(Array<double>{0.1, 16777217}).join(), "0.10000000149011612,16777216");
  CHECK_STR(BigInt64Array::fromArray(Array<BigInt>{BigInt::fromUint64(UINT64_MAX), BigInt::fromInt64(-2)}).join(), "-1,-2");
  CHECK_STR(BigUint64Array::fromArray(Array<BigInt>{BigInt::fromInt64(-1)}).join(), "18446744073709551615");

  // Views over one buffer: at an aligned offset, little-endian as the host is.
  ArrayBuffer buffer(8.0);
  Uint8Array bytes = Bytes::over(buffer);
  Uint16Array words = Uint16Array::over(buffer, 2.0, 2.0);
  words.set(0, 0x0102);
  CHECK(bytes.at(2) == 2 && bytes.at(3) == 1);
  CHECK(words.byteOffset() == 2 && words.byteLength() == 4 && words.length() == 2);
  CHECK_THROWS(Uint32Array::over(buffer, 2.0), "RangeError");
  CHECK_THROWS(Uint32Array::over(ArrayBuffer(6.0)), "RangeError");
  CHECK_THROWS(Float64Array::over(buffer, 0.0, 2.0), "RangeError");
  CHECK(strictEquals(words.arrayBuffer(), buffer));

  // subarray shares, slice copies; set converts from another kind.
  Float64Array f = Float64Array::fromArray(Array<double>{1.5, -0.0, NAN, 3});
  f.subarray(1, 2).set(0, 2);
  CHECK(f.at(1) == 2);
  Float64Array copy = f.slice(0, 2);
  copy.set(0, 9);
  CHECK(f.at(0) == 1.5);
  Int8Array narrow(4.0);
  narrow.setFrom(f);
  CHECK_STR(narrow.join(), "1,2,0,3");
  CHECK_THROWS(narrow.setFrom(f, 1.0), "RangeError");

  // %TypedArray%'s methods: NaN is never indexOf, but includes; the default sort is numeric.
  Float64Array g = Float64Array::fromArray(Array<double>{3, NAN, -0.0, 0, -1, 10});
  CHECK(g.indexOf(NAN) == -1 && g.includes(NAN) && g.indexOf(0) == 2 && g.lastIndexOf(0) == 3);
  CHECK_STR(g.toSorted().join(), "-1,0,0,3,10,NaN");
  CHECK(std::signbit(g.toSorted().at(1)) && !std::signbit(g.toSorted().at(2)));
  CHECK_STR(g.toReversed().join(), "10,-1,0,0,NaN,3");
  CHECK(g.atIndex(-1).get() == 10 && !g.atIndex(6).has());
  CHECK_STR(g.with(-1, 4).join(), "3,NaN,0,0,-1,4");
  CHECK_THROWS(g.with(6, 4), "RangeError");
  CHECK_STR(Int16Array::fromArray(Array<double>{1, 2, 3, 4, 5}).copyWithin(0, 3).join(), "4,5,3,4,5");
  CHECK_STR(Int16Array::fromArray(Array<double>{5, 1, 4}).sort([](double a, double b) { return b - a; }).join(), "5,4,1");
  CHECK_THROWS(Int16Array(0.0).reduce([](double a, double b) { return a + b; }), "TypeError");
  CHECK(Int16Array::fromArray(Array<double>{1, 2, 3}).reduce([](double a, double b) { return a + b; }) == 6);
  CHECK_STR(Float32Array::fromTyped(Int16Array::fromArray(Array<double>{-2, 7})).join(), "-2,7");

  // DataView: big-endian unless asked, bounds checked, values converted.
  DataView view = DataView::over(buffer, 1.0);
  view.setUint16(0, 0x0102);
  CHECK(bytes.at(1) == 1 && bytes.at(2) == 2);
  view.setUint16(0, 0x0102, true);
  CHECK(bytes.at(1) == 2 && bytes.at(2) == 1);
  CHECK(view.getUint16(0, true) == 0x0102 && view.getUint16(0) == 0x0201);
  DataView whole = DataView::over(buffer);
  whole.setFloat64(0, -2.5);
  CHECK(whole.getFloat64(0) == -2.5 && whole.getFloat64(0, true) != -2.5);
  whole.setBigInt64(0, BigInt::fromInt64(-3), true);
  CHECK(whole.getBigInt64(0, true) == BigInt::fromInt64(-3) &&
        whole.getBigUint64(0, true) == BigInt::fromUint64(UINT64_MAX - 2));
  view.setInt8(0, 200);
  CHECK(view.getInt8(0) == -56 && view.getUint8(0) == 200);
  CHECK(view.byteOffset() == 1 && view.byteLength() == 7);
  CHECK_THROWS(view.getUint32(4), "RangeError");
  CHECK_THROWS(view.setFloat64(1, 0), "RangeError");
  CHECK_THROWS(DataView::over(buffer, 9.0), "RangeError");
  CHECK_THROWS(DataView::over(buffer, 4.0, 5.0), "RangeError");
}

static void concatenation() {
  CHECK_STR(concat(S("w"), 42.0), "w42");
  CHECK_STR(concat(S("["), -0.0, S("]"), 0.0), "[0]0");
  CHECK_STR(concat(0.1 + 0.2, S(" "), 1e21, S(" "), 1.5e-7, S(" "), -1.25), "0.30000000000000004 1e+21 1.5e-7 -1.25");
  CHECK_STR(concat(std::nan(""), S(" "), INFINITY, S(" "), -INFINITY), "NaN Infinity -Infinity");
  CHECK_STR(concat(9007199254740992.0, S(" "), -123456789012.0), "9007199254740992 -123456789012");
  CHECK_STR(concat(int32_t{-5}, S(" "), uint32_t{4294967295u}, S(" "), int64_t{-9007199254740991}), "-5 4294967295 -9007199254740991");
  CHECK_STR(concat(S("é"), S("ω"), 1.0), "éω1");
  CHECK_STR(concat(S("ω"), S("é")), "ωé");
  CHECK(concat(S(""), S("")).empty());
  CHECK(concat(S("ab"), S("")) == S("ab"));
  CHECK_STR(concat(S("same")), "same");
}

template <class T>
static bool settleWithin(const Promise<T>& p, int ms) {
  for (int i = 0; i < ms; i++) {
    {
      LucentScope scope;
      if (p.settled()) return true;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return false;
}

static void mainThread() {
  CHECK(!onMainThread());
  Promise<double> p;
  {
    LucentScope scope;
    p = runOnMain([] { return onMainThread() ? 42.0 : -1.0; });
  }
  CHECK(settleWithin(p, 2000));
  CHECK(p.fulfilled() && p.value() == 42.0);

  Promise<void> failed;
  {
    LucentScope scope;
    failed = runOnMain([] { throw Exception(makeError(String::fromLatin1("RangeError"), S("on main"))); });
  }
  CHECK(settleWithin(failed, 2000));
  CHECK(!failed.fulfilled() && failed.error()->message == S("on main"));
}

/// Whether another thread could take the Lucent lock right now.
static bool lockFree() {
  bool free = false;
  std::thread([&] {
    free = Actor::shared().lock().try_lock();
    if (free) Actor::shared().lock().unlock();
  }).join();
  return free;
}

static void platformCallbacks() {
  // A callback that returns nothing and outlives the call: queued on the
  // Lucent thread, which holds the lock; what it captured goes with it.
  std::atomic<bool> onLucent{false}, locked{false};
  auto captured = std::make_shared<int>(1);
  std::weak_ptr<int> watch = captured;
  std::thread([&, captured = std::move(captured)]() mutable {
    postCallback([&, captured = std::move(captured)] {
      onLucent = Actor::shared().onActorThread();
      locked = !lockFree();
    });
  }).join();
  Actor::shared().waitIdle(2000);
  CHECK(onLucent && locked);
  CHECK(watch.expired());

  // One the platform waits for (a result, or during the call): on the
  // calling thread, holding the lock.
  std::thread::id caller, ran;
  double result = 0;
  bool heldDuring = false;
  std::thread([&] {
    caller = std::this_thread::get_id();
    result = callNow([&] {
      ran = std::this_thread::get_id();
      heldDuring = !lockFree();
      return 2.5;
    });
  }).join();
  CHECK(ran == caller && heldDuring && result == 2.5);
  CHECK(lockFree());

  // Lucent errors do not reach the platform: reported, and a default result.
  double failed = callNow([]() -> double { throw Exception(makeError(String::fromLatin1("RangeError"), S("in a callback"))); });
  CHECK(failed == 0);
  postCallback([] { throw Exception(makeError(S("queued"))); });
  CHECK(Actor::shared().waitIdle(2000));
}

/// The native references Lucent holds are counted: debug builds report what
/// is left when the module goes.
static void nativeReferenceCount() {
  static int released = 0;
  long before = liveNativeRefs();
  {
    NativeRef a(new int(1), [](void* p) { delete static_cast<int*>(p); released++; }, nullptr);
    NativeRef b = a;
    NativeRef empty;
    CHECK(liveNativeRefs() == before + 1);
  }
  CHECK(liveNativeRefs() == before && released == 1);
}

/// What debug builds report when a JavaScript runtime's module goes counts
/// only what module code made: not what the main context made (views'
/// setups and the callbacks they give the platform, released as the
/// renderer drops its views and the platform collects its callbacks, on
/// their own schedule), nor what is kept for the process.
static void moduleNativeReferenceCount() {
  auto release = [](void* p) { delete static_cast<int*>(p); };
  long module = moduleNativeRefs();
  long all = liveNativeRefs();

  {
    // Module code: made holding the Lucent lock.
    NativeRef made = callNow([&] { return NativeRef(new int(1), release, nullptr); });

    CHECK(moduleNativeRefs() == module + 1 && liveNativeRefs() == all + 1);

    // A view's setup: made in the main context.
    std::promise<NativeRef> made2;
    ExecutionContext::main().post([&] { made2.set_value(NativeRef(new int(2), release, nullptr)); });
    NativeRef view = made2.get_future().get();

    CHECK(moduleNativeRefs() == module + 1 && liveNativeRefs() == all + 2);

    // Kept as long as the process (the Android Application).
    NativeRef app = callNow([&] { return NativeRef(new int(3), release, nullptr); });
    app.keepForProcess();

    CHECK(moduleNativeRefs() == module + 1 && liveNativeRefs() == all + 3);
  }

  CHECK(moduleNativeRefs() == module && liveNativeRefs() == all);
}

/// Blocks until the main thread has run what was posted to it before.
static bool mainCaughtUp(int ms) {
  auto done = std::make_shared<std::atomic<bool>>(false);
  postToMain([done] { *done = true; });

  auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
  while (!*done) {
    if (std::chrono::steady_clock::now() > deadline) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  return true;
}

/// A platform object that must be released on the main thread (a UIKit
/// object) is, whichever thread drops its last reference: there at once,
/// else posted. It counts as held until it is released.
static void nativeReferencesReleaseOnTheirContext() {
  static std::atomic<int> released{0};
  static std::atomic<int> releasedOnMain{0};
  auto release = [](void* p) {
    delete static_cast<int*>(p);
    if (onMainThread()) releasedOnMain++;
    released++;
  };
  ExecutionContext& main = ExecutionContext::main();
  long before = liveNativeRefs();

  {
    NativeRef a(new int(1), release, nullptr, &main);

    // A copy dropped on another thread leaves it held.
    std::thread([copy = a] {}).join();
    CHECK(released == 0);
  }

  CHECK(mainCaughtUp(2000));
  CHECK(released == 1 && releasedOnMain == 1);
  CHECK(liveNativeRefs() == before);

  // Dropped on the main thread, even in a platform callback holding the
  // Lucent lock: released before the callback returns.
  std::atomic<bool> inPlace{false};
  postToMain([&] {
    callNow([&] {
      { NativeRef b(new int(2), release, nullptr, &main); }
      inPlace = released == 2;
    });
  });

  CHECK(mainCaughtUp(2000));
  CHECK(inPlace && releasedOnMain == 2);
  CHECK(liveNativeRefs() == before);
}

/// An SDK object, as a struct field, stringifies as a host object does:
/// no enumerable own properties (issue #11).
static void nativeRefJson() {
  NativeRef r(new int(1), [](void* p) { delete static_cast<int*>(p); }, nullptr);
  CHECK(json::stringify(r).toUtf8() == "{}");
  CHECK(json::stringify(Opt<NativeRef>(null)).toUtf8() == "null");
}

/// JSON.stringify's property list and gap, re-writing compact text as
/// JavaScript writes it (each expectation is node's).
static void jsonFormat() {
  auto f = [](const char* compact, Opt<Array<String>> keys, const String& gap) {
    std::u16string in;
    for (const char* c = compact; *c; c++) in.push_back(static_cast<unsigned char>(*c));
    return String::fromUtf16(json::format(in, keys, gap)).toUtf8();
  };
  const char* v = R"({"b":[1,{"a":"x,}\"y","c":[]}],"a":{},"c":"q"})";
  Opt<Array<String>> none = undefined;
  CHECK(f(v, none, json::gapOf(2.0)) ==
        "{\n  \"b\": [\n    1,\n    {\n      \"a\": \"x,}\\\"y\",\n      \"c\": []\n    }\n  ],\n  \"a\": {},\n  \"c\": \"q\"\n}");
  CHECK(f(v, json::keysOf(Array<String>{String::fromLatin1("c"), String::fromLatin1("a"), String::fromLatin1("c")}), String()) ==
        R"({"c":"q","a":{}})");
  CHECK(f(v, json::keysOf(Array<String>{String::fromLatin1("b"), String::fromLatin1("a")}), json::gapOf(String::fromLatin1("\t"))) ==
        "{\n\t\"b\": [\n\t\t1,\n\t\t{\n\t\t\t\"a\": \"x,}\\\"y\"\n\t\t}\n\t],\n\t\"a\": {}\n}");
  CHECK(json::gapOf(20.0).length() == 10 && json::gapOf(0.5).length() == 0);
  CHECK(json::gapOf(String::fromLatin1("abcdefghijkl")).toUtf8() == "abcdefghij");
  CHECK(f("[]", none, json::gapOf(4.0)) == "[]");
  CHECK(f("\"s\"", none, json::gapOf(4.0)) == "\"s\"");
}

/// TextDecoder's UTF-8 decoding, whole and streamed one byte at a time,
/// and TextEncoder's encodeInto at each size of its destination.
static void textCodec() {
  auto units = [](const String& s) {
    std::string out;
    for (size_t i = 0; i < s.length(); i++) {
      char b[8];
      std::snprintf(b, sizeof b, "%s%x", i ? " " : "", static_cast<unsigned>(s.unit(i)));
      out += b;
    }
    return out;
  };
  const std::vector<uint8_t> bad = {0xE2, 0x82, 0x41, 0xED, 0xA0, 0x80, 0xF0, 0x9F, 0x98, 0x80, 0xF0, 0x90, 0x80};
  CHECK(units(utf8DecodeBytes(bad.data(), bad.size())) == "fffd 41 fffd fffd fffd d83d de00 fffd");

  // Byte by byte, a stream decodes the same.
  auto decoder = makeTextDecoder(String::fromLatin1("utf-8"), false, false);
  std::string streamed;
  for (uint8_t b : bad) streamed += units(decoder->decode(&b, 1, true)) + "|";
  streamed += units(decoder->decode(false));
  CHECK(streamed == "||fffd 41||fffd fffd|fffd||||d83d de00||||fffd");

  // A BOM split over chunks is dropped once, and a fatal decoder throws.
  const uint8_t bom[] = {0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF};
  CHECK(units(decoder->decode(bom, 2, true)) == "");
  CHECK(units(decoder->decode(bom + 2, 4, false)) == "feff");
  auto fatal = makeTextDecoder(undefined, true, false);
  CHECK_THROWS(fatal->decode(bad.data(), 2, false), "TypeError");
  CHECK(units(fatal->decode(bad.data(), 2, true)) == "");
  CHECK_THROWS(makeTextDecoder(String::fromLatin1("latin1"), false, false), "RangeError");
  CHECK(!makeTextDecoder(String::fromLatin1(" UTF8\n"), true, true)->decode(nullptr, 0, false).length());

  // "aé😀": 1, 2 and 4 bytes; a lone surrogate is U+FFFD, 3.
  const char16_t text[] = u"a\u00e9\U0001F600\xD800";
  const String source = String::fromUtf16(text, 5);
  TextEncoderObject encoder;
  std::string counts;
  for (size_t size : {0, 1, 2, 3, 6, 7, 9, 10}) {
    Bytes into(static_cast<double>(size));
    double read = 0, written = 0;
    encoder.encodeInto(source, into, read, written);
    counts += std::to_string(static_cast<int>(read)) + "/" + std::to_string(static_cast<int>(written)) + " ";
  }
  CHECK(counts == "0/0 1/1 1/1 2/3 2/3 4/7 4/7 5/10 ");
}

int main() {
  textCodec();
  jsonFormat();
  typedArrays();
  deepRegExps();
  stackExhaustionThrows();
  numbers();
  exactIntegers();
  nativeRefJson();
  mainThread();
  platformCallbacks();
  nativeReferenceCount();
  moduleNativeReferenceCount();
  nativeReferencesReleaseOnTheirContext();
  concatenation();
  strings();
  stringStorage();
  indexes();
  arrays();
  maps();
  optionalsAndUnions();
  weakReferences();
  weakCollections();
  finalizationRegistries();
  qualifiedStrictEquals();
  qualifiedToJsString();
  mixedStrictEquals();
  errors();
  unassignedStorage();
  temporalDeadZone();
  async();
  promiseCombinators();
  timersPostedWhileWaiting();
  abortSignals();
  dates();
  generators();
  bytes();
  std::printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
