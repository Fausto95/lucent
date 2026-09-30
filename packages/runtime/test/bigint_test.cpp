// Unit tests for BigInt (lucent/bigint.h): JavaScript's BigInt semantics at
// any precision, checked case by case against the corpus node writes
// (bigint/corpus.ts), plus what the corpus cannot show: no allocation for
// values within 64 bits, Map and Set keys, native conversions. Built and run
// by `packages/runtime/test/run.sh` (which writes the corpus), also under
// ASan/UBSan and TSan. With LUCENT_BIGINT_BENCH=1 it also prints the cost
// of add, mul and the 64-bit conversions against int64_t (build with -O2).
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <limits>
#include <new>
#include <sstream>
#include <string>
#include <vector>

#include "lucent/lucent.h"
#include "lucent/transport.h"

using namespace lucent;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                                 \
  do {                                                                              \
    checks++;                                                                       \
    if (!(cond)) {                                                                  \
      failures++;                                                                   \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                               \
  } while (0)

// --- allocations ----------------------------------------------------------------

static std::atomic<long> allocations{0};

void* operator new(size_t size) {
  allocations.fetch_add(1, std::memory_order_relaxed);
  if (void* p = std::malloc(size ? size : 1)) return p;
  throw std::bad_alloc();
}

void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, size_t) noexcept { std::free(p); }

/// How many times `f` allocated.
template <class F>
static long allocationsIn(F f) {
  long before = allocations.load();
  f();
  return allocations.load() - before;
}

// --- the corpus -----------------------------------------------------------------

static BigInt big(const std::string& decimal) { return BigInt::parse(std::string_view(decimal)); }

static double fromBits(const std::string& token) {
  uint64_t bits = std::stoull(token.substr(2), nullptr, 16);
  double d;
  std::memcpy(&d, &bits, sizeof d);
  return d;
}

static std::string bitsOf(double d) {
  uint64_t bits;
  std::memcpy(&bits, &d, sizeof bits);
  char out[32];
  std::snprintf(out, sizeof out, "d:%016llx", static_cast<unsigned long long>(bits));
  return out;
}

static String textOf(const std::string& token) {
  std::string utf8;
  for (size_t i = 2; i + 1 < token.size(); i += 2) utf8.push_back(static_cast<char>(std::stoi(token.substr(i, 2), nullptr, 16)));
  return String::fromUtf8(utf8);
}

/// What the runtime gives for one corpus case, in the corpus's notation.
static std::string evaluate(const std::vector<std::string>& c) {
  const std::string& op = c[0];

  try {
    if (op == "add") return (big(c[1]) + big(c[2])).toString().toUtf8();
    if (op == "sub") return (big(c[1]) - big(c[2])).toString().toUtf8();
    if (op == "mul") return (big(c[1]) * big(c[2])).toString().toUtf8();
    if (op == "div") return (big(c[1]) / big(c[2])).toString().toUtf8();
    if (op == "mod") return (big(c[1]) % big(c[2])).toString().toUtf8();
    if (op == "and") return (big(c[1]) & big(c[2])).toString().toUtf8();
    if (op == "or") return (big(c[1]) | big(c[2])).toString().toUtf8();
    if (op == "xor") return (big(c[1]) ^ big(c[2])).toString().toUtf8();
    if (op == "shl") return (big(c[1]) << big(c[2])).toString().toUtf8();
    if (op == "shr") return (big(c[1]) >> big(c[2])).toString().toUtf8();
    if (op == "ushr") return BigInt::unsignedShiftRight(big(c[1]), big(c[2])).toString().toUtf8();
    if (op == "pow") return BigInt::pow(big(c[1]), big(c[2])).toString().toUtf8();
    if (op == "neg") return (-big(c[1])).toString().toUtf8();
    if (op == "not") return (~big(c[1])).toString().toUtf8();

    if (op == "cmp") {
      auto order = big(c[1]) <=> big(c[2]);
      return order < 0 ? "-1" : order > 0 ? "1" : "0";
    }

    if (op == "eq") return strictEquals(big(c[1]), big(c[2])) ? "true" : "false";
    if (op == "num") return bitsOf(big(c[1]).toDouble());
    if (op == "i64") return std::to_string(big(c[1]).toInt64());
    if (op == "u64") return std::to_string(big(c[1]).toUint64());
    if (op == "wi64") return std::to_string(big(c[1]).wrapToInt64());
    if (op == "wu64") return std::to_string(big(c[1]).wrapToUint64());
    if (op == "tostr") return big(c[1]).toString(std::stod(c[2])).toUtf8();
    if (op == "intn") return BigInt::asIntN(std::stod(c[1]), big(c[2])).toString().toUtf8();
    if (op == "uintn") return BigInt::asUintN(std::stod(c[1]), big(c[2])).toString().toUtf8();
    if (op == "fromnum") return BigInt::fromDouble(fromBits(c[1])).toString().toUtf8();

    if (op == "cmpnum") {
      auto order = compare(big(c[1]), fromBits(c[2]));
      if (order == std::partial_ordering::unordered) return "u";
      return order < 0 ? "<" : order > 0 ? ">" : "=";
    }

    if (op == "parse") return BigInt::parse(textOf(c[1])).toString().toUtf8();
  } catch (const Exception& e) {
    return "!" + e.error()->name.toUtf8();
  }

  return "?unknown operation " + op;
}

static void agreesWithJavaScript(const char* path) {
  std::ifstream in(path);
  if (!in) {
    std::fprintf(stderr, "cannot read the corpus at %s\n", path);
    failures++;
    return;
  }

  int cases = 0;
  int wrong = 0;

  for (std::string line; std::getline(in, line);) {
    if (line.empty()) continue;

    std::vector<std::string> fields;
    std::stringstream split(line);
    for (std::string field; std::getline(split, field, '\t');) fields.push_back(field);

    std::string expected = fields.back();
    fields.pop_back();

    std::string actual = evaluate(fields);
    cases++;

    if (actual != expected) {
      if (wrong++ < 20) std::fprintf(stderr, "corpus: %s gave %s, JavaScript %s\n", line.c_str(), actual.c_str(), expected.c_str());
    }
  }

  checks++;
  if (wrong) failures++;

  std::printf("bigint: %d corpus cases, %d disagree with JavaScript\n", cases, wrong);
}

// --- what the corpus cannot show ---------------------------------------------------

static void valuesWithin64BitsDoNotAllocate() {
  BigInt a = BigInt::fromInt64(1234567890123);
  BigInt b = BigInt::fromInt64(-987654321);
  BigInt sum, product, quotient, masked, shifted;
  int64_t back = 0;

  long made = allocationsIn([&] {
    sum = a + b;
    product = b * BigInt::fromInt64(1000);
    quotient = a / b;
    masked = (a & b) | (a ^ ~b);
    shifted = (a << BigInt::fromInt64(3)) >> BigInt::fromInt64(5);
    back = BigInt::fromUint64(42).toInt64() + (a - b).toInt64() + (-a).wrapToInt64();
    back += BigInt::fromDouble(-4096).toInt64() + (sum < product ? 1 : 0) + (compare(a, 1.5) > 0 ? 1 : 0);
    back += BigInt::pow(BigInt::fromInt64(3), BigInt::fromInt64(20)).toInt64() % 7;
  });

  CHECK(made == 0);
  CHECK(sum.toInt64() == 1234567890123 - 987654321);
  CHECK(back != 0);

  // Beyond 64 bits it does; copies share the storage.
  BigInt huge = BigInt::fromUint64(UINT64_MAX) * BigInt::fromUint64(UINT64_MAX);
  BigInt copy;
  CHECK(allocationsIn([&] { copy = huge; }) == 0);
  CHECK(strictEquals(copy, huge));
}

static void exactNativeConversions() {
  CHECK(BigInt::fromInt64(INT64_MIN).toInt64() == INT64_MIN);
  CHECK(BigInt::fromInt64(INT64_MAX).toInt64() == INT64_MAX);
  CHECK(BigInt::fromUint64(UINT64_MAX).toUint64() == UINT64_MAX);
  CHECK(BigInt::fromUint64(UINT64_MAX).toString() == String::fromLatin1("18446744073709551615"));

  // Long.MAX_VALUE and NSNotFound stay exact.
  CHECK(BigInt(INT64_MAX).toString() == String::fromLatin1("9223372036854775807"));
  CHECK(BigInt(static_cast<unsigned long>(INT64_MAX)).toInt64() == INT64_MAX);
  CHECK(BigInt(static_cast<int32_t>(-5)).toInt64() == -5);
  CHECK(BigInt(static_cast<uint8_t>(200)).toInt64() == 200);

  // The wrapping forms are asIntN(64) / asUintN(64).
  CHECK(BigInt::fromInt64(-1).wrapToUint64() == UINT64_MAX);
  CHECK(BigInt::fromUint64(UINT64_MAX).wrapToInt64() == -1);

  auto name = [](auto f) {
    try {
      f();
    } catch (const Exception& e) {
      return e.error()->name.toUtf8();
    }
    return std::string();
  };

  CHECK(name([] { BigInt::fromUint64(UINT64_MAX).toInt64(); }) == "RangeError");
  CHECK(name([] { BigInt::fromInt64(-1).toUint64(); }) == "RangeError");
  CHECK(name([] { (BigInt::fromInt64(1) + BigInt::fromUint64(UINT64_MAX)).toUint64(); }) == "RangeError");

  auto tried = BigInt::fromInt64(-3).tryUint64();
  CHECK(!tried.has_value());
  CHECK(BigInt::fromUint64(7).tryInt64() == std::optional<int64_t>(7));
}

static void mapAndSetKeysAreValues() {
  BigInt small = BigInt::fromInt64(5);
  BigInt sameSmall = BigInt::fromUint64(10) / BigInt::fromInt64(2);
  BigInt large = BigInt::parse(std::string_view("123456789012345678901234567890"));
  BigInt sameLarge = BigInt::parse(std::string_view("0x18ee90ff6c373e0ee4e3f0ad2"));

  CHECK(strictEquals(small, sameSmall) && sameValueZero(small, sameSmall));
  CHECK(strictEquals(large, sameLarge) && large.hash() == sameLarge.hash());
  CHECK(!strictEquals(small, large));

  Map<BigInt, double> map;
  map.set(small, 1).set(large, 2);
  CHECK(map.get(sameSmall).get() == 1 && map.get(sameLarge).get() == 2);
  CHECK(!map.has(BigInt::fromInt64(6)));

  Set<BigInt> set;
  set.add(large).add(sameLarge).add(small);
  CHECK(set.size() == 2);
}

static void stringsAndLiterals() {
  CHECK(toJsString(BigInt::fromInt64(-42)) == String::fromLatin1("-42"));
  CHECK((String::fromLatin1("id ") + toJsString(BigInt::fromUint64(UINT64_MAX))) == String::fromLatin1("id 18446744073709551615"));

  const BigInt& literal = LUCENT_BIGINT("340282366920938463463374607431768211456");
  CHECK(literal == BigInt::pow(BigInt::fromInt64(2), BigInt::fromInt64(128)));

  CHECK(BigInt::fromInt64(3) == 3.0 && BigInt::fromInt64(3) != 3.5);
  CHECK(BigInt::fromInt64(1) < 1.5 && 1.5 > BigInt::fromInt64(1));
  CHECK(!(BigInt::fromInt64(1) < std::numeric_limits<double>::quiet_NaN()));
}

/// What generated code calls on a bigint: ToBoolean, typeof, JSON, errors.
static void whatTheCompilerEmits() {
  using Maybe = Opt<BigInt>;
  using Either = std::variant<BigInt, String>;

  CHECK(!truthy(BigInt()) && truthy(BigInt::fromInt64(-1)) && truthy(BigInt::pow(BigInt::fromInt64(2), BigInt::fromInt64(80))));
  CHECK(!truthy(Maybe(BigInt())) && truthy(Maybe(BigInt::fromInt64(3))) && !truthy(Maybe(undefined)));
  CHECK(!truthy(Either(BigInt())) && truthy(Either(BigInt::fromInt64(7))));

  CHECK(typeOf(BigInt::fromInt64(1)) == String::fromLatin1("bigint"));
  CHECK(typeOf(Maybe(BigInt())) == String::fromLatin1("bigint") && typeOf(Either(BigInt())) == String::fromLatin1("bigint"));

  CHECK(strictEquals(Maybe(BigInt::fromInt64(4)), BigInt::fromInt64(4)) && !strictEquals(Either(BigInt()), Either(String())));

  auto failure = [](auto f) {
    try {
      f();
    } catch (const Exception& e) {
      return e.error()->name.toUtf8() + ": " + e.error()->message.toUtf8();
    }
    return std::string();
  };

  CHECK(failure([] { json::stringify(BigInt::fromInt64(1)); }) == "TypeError: Do not know how to serialize a BigInt");
  CHECK(failure([] { json::stringify(Array<BigInt>{BigInt()}); }) == "TypeError: Do not know how to serialize a BigInt");
  CHECK(json::stringify(Maybe(undefined)) == String::fromLatin1("undefined"));

  // V8's messages, which the differential tests compare.
  CHECK(failure([] { BigInt::fromDouble(1.5); }) == "RangeError: The number 1.5 cannot be converted to a BigInt because it is not an integer");
  CHECK(failure([] { BigInt::fromInt64(5).toString(37); }) == "RangeError: toString() radix argument must be between 2 and 36");
  CHECK(failure([] { BigInt::parse(std::string_view("1.5")); }) == "SyntaxError: Cannot convert 1.5 to a BigInt");
}

/// What SDK glue passes a native API: each native integer type's whole
/// range exactly, and a RangeError naming the value's use beyond it.
static void nativeIntegersForTheGlue() {
  CHECK(toNativeInteger<int64_t>(BigInt::fromInt64(INT64_MIN), "x") == INT64_MIN);
  CHECK(toNativeInteger<uint64_t>(BigInt::fromUint64(UINT64_MAX), "x") == UINT64_MAX);
  CHECK(toNativeInteger<int32_t>(BigInt(-7), "x") == -7);

  auto failure = [](auto f) {
    try {
      f();
    } catch (const Exception& e) {
      return e.error()->name.toUtf8() + ": " + e.error()->message.toUtf8();
    }
    return std::string();
  };

  CHECK(failure([] { toNativeInteger<uint64_t>(BigInt(-1), "length of NSRange"); }) ==
        "RangeError: length of NSRange: -1 is out of range for a 64-bit unsigned integer");
  CHECK(failure([] { toNativeInteger<int64_t>(BigInt::fromUint64(UINT64_MAX), "ms of SystemClock.sleep"); }) ==
        "RangeError: ms of SystemClock.sleep: 18446744073709551615 is out of range for a 64-bit signed integer");
  CHECK(failure([] { toNativeInteger<int32_t>(BigInt(INT64_C(1) << 31), "x"); }) ==
        "RangeError: x: 2147483648 is out of range for a 32-bit signed integer");
}

static void computeTasksTakeThemAsTheyAre() {
  static_assert(Transportable<BigInt>);
  static_assert(Transportable<Array<BigInt>>);

  BigInt value = BigInt::parse(std::string_view("99999999999999999999999"));
  CHECK(strictEquals(transportCopy(value), value));
}

// --- measurements -------------------------------------------------------------------

template <class F>
static double nsPer(int n, F f) {
  auto start = std::chrono::steady_clock::now();
  f(n);
  return std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count() / n;
}

static void measure() {
  const int n = 20000000;
  volatile int64_t sink = 0;

  double intAdd = nsPer(n, [&](int count) {
    int64_t acc = 0;
    for (int i = 0; i < count; i++) acc += static_cast<int64_t>(i) ^ (sink & 1);
    sink = acc;
  });

  double bigAdd = nsPer(n, [&](int count) {
    BigInt acc;
    for (int i = 0; i < count; i++) acc = acc + BigInt::fromInt64(static_cast<int64_t>(i) ^ (sink & 1));
    sink = acc.toInt64();
  });

  double intMul = nsPer(n, [&](int count) {
    int64_t acc = 1;
    for (int i = 0; i < count; i++) acc = acc * 3 % 1000003 + (i ^ (sink & 1));
    sink = acc;
  });

  double bigMul = nsPer(n, [&](int count) {
    BigInt acc = BigInt::fromInt64(1);
    BigInt three = BigInt::fromInt64(3), modulus = BigInt::fromInt64(1000003);
    for (int i = 0; i < count; i++) acc = acc * three % modulus + BigInt::fromInt64(i ^ (sink & 1));
    sink = acc.toInt64();
  });

  double convert = nsPer(n, [&](int count) {
    int64_t acc = 0;
    for (int i = 0; i < count; i++) acc += BigInt::fromInt64(i ^ (sink & 1)).toInt64();
    sink = acc;
  });

  BigInt a = BigInt::pow(BigInt::fromInt64(7), BigInt::fromInt64(60));
  BigInt b = BigInt::pow(BigInt::fromInt64(5), BigInt::fromInt64(55));
  double multiLimb = nsPer(n / 20, [&](int count) {
    BigInt acc;
    for (int i = 0; i < count; i++) acc = a * b + acc % a;
    sink = acc.wrapToInt64();
  });

  std::printf("bench: add %.2f ns (int64 %.2f); mul+mod+add %.2f ns (int64 %.2f); fromInt64+toInt64 %.2f ns; 169x128-bit mul+mod+add %.1f ns\n",
              bigAdd, intAdd, bigMul, intMul, convert, multiLimb);
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: bigint_test <corpus> (run.sh writes it with bigint/corpus.ts)\n");
    return 2;
  }

  agreesWithJavaScript(argv[1]);

  valuesWithin64BitsDoNotAllocate();
  exactNativeConversions();
  mapAndSetKeysAreValues();
  stringsAndLiterals();
  whatTheCompilerEmits();
  nativeIntegersForTheGlue();
  computeTasksTakeThemAsTheyAre();

  if (const char* bench = std::getenv("LUCENT_BIGINT_BENCH"); bench && std::string(bench) == "1") measure();

  std::printf("bigint: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
