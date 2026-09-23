// Unit tests for the Lucent C++ runtime. Built and run by
// `packages/runtime/test/run.sh` (optionally under ASan/UBSan).
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
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
  CHECK_STR(numberToFixed(-0.0001, 2), "0.00");
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
  CHECK_STR(S("ÀÉÎ ΣΑΣ Привет").toLowerCase(), "àéî σασ привет");
  CHECK_STR(S("straße").toUpperCase(), "STRASSE");
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
}

static void errors() {
  try {
    throwError(S("TypeError"), S("bad"));
  } catch (const Exception& e) {
    CHECK_STR(errorToString(e.error()), "TypeError: bad");
  }
  Error e = currentError(std::make_exception_ptr(std::runtime_error("boom")));
  CHECK_STR(e->message, "boom");
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

int main() {
  numbers();
  strings();
  arrays();
  maps();
  optionalsAndUnions();
  errors();
  async();
  timersPostedWhileWaiting();
  abortSignals();
  dates();
  generators();
  bytes();
  std::printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
