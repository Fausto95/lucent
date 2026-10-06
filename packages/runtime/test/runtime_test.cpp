// Unit tests for the Lucent C++ runtime. Built and run by
// `packages/runtime/test/run.sh` (optionally under ASan/UBSan).
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
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
  CHECK_STR(S("a-b-c").replace(S("-"), S("+")), "a+b-c");
  CHECK_STR(S("a-b-c").replaceAll(S("-"), S("+")), "a+b+c");
  CHECK_STR(S("ab").replaceAll(S(""), S("-")), "-a-b-");
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
  Array<Opt<double>> holes;
  holes.set(2, 1.0);
  CHECK(holes.size() == 3 && !holes.at(0).has());
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
  Scheduler::instance().waitIdle(1000);
  CHECK(order == "abc");

  Promise<double> total;
  Promise<String> caught;
  {
    LucentScope scope;
    total = sumAll(Array<double>{1, 2, 3});
    caught = catches();
  }
  for (int i = 0; i < 100 && !(total.settled() && caught.settled()); i++) Scheduler::instance().waitIdle(50);
  {
    LucentScope scope;
    CHECK(total.fulfilled());
    CHECK(total.value() == 9);
    CHECK(caught.fulfilled());
    CHECK_STR(caught.value(), "nope");
  }
}

// The Lucent thread sleeps until the earliest timer while other threads add
// timers; growing the timer heap must not invalidate the deadline it waits on.
static void timersPostedWhileWaiting() {
  std::atomic<int> fired{0};
  Scheduler& s = Scheduler::instance();
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
  Scheduler::instance().waitIdle(2000);
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
  Scheduler::instance().waitIdle(2000);
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
    free = Scheduler::instance().lock().try_lock();
    if (free) Scheduler::instance().lock().unlock();
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
      onLucent = Scheduler::instance().onLucentThread();
      locked = !lockFree();
    });
  }).join();
  Scheduler::instance().waitIdle(2000);
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
  CHECK(Scheduler::instance().waitIdle(2000));
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

int main() {
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
  qualifiedStrictEquals();
  qualifiedToJsString();
  mixedStrictEquals();
  errors();
  unassignedStorage();
  async();
  timersPostedWhileWaiting();
  abortSignals();
  dates();
  generators();
  bytes();
  std::printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
