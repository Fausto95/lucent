// Unit tests for a toolkit body's list, by key (lucent/items.h): an item
// is found again by its key until the next array is keyed, and a key two
// items share, or a NaN key, is an error. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <cmath>
#include <cstdio>

#include "lucent/items.h"

using lucent::String;
using lucent::ui::Items;

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

template <class F>
static bool throws(F f) {
  try {
    f();
  } catch (...) {
    return true;
  }
  return false;
}

// An item is found by its key while its array is the latest keyed.
static void findsItemsByKey() {
  Items<String, double> items;

  items.add(String::fromLatin1("a"), 1);
  items.add(String::fromLatin1("b"), 2);
  CHECK(items.find(String::fromLatin1("b")).has());
  CHECK(items.find(String::fromLatin1("b")).get() == 2);
  CHECK(!items.find(String::fromLatin1("c")).has());

  // A new array: what it no longer holds is gone.
  items.clear();
  items.add(String::fromLatin1("b"), 3);
  CHECK(!items.find(String::fromLatin1("a")).has());
  CHECK(items.find(String::fromLatin1("b")).get() == 3);
}

// Keys are unique, and a number key is never NaN.
static void refusesDuplicateAndNaNKeys() {
  Items<double, String> items;

  items.add(1, String::fromLatin1("one"));
  CHECK(throws([&] { items.add(1, String::fromLatin1("again")); }));
  CHECK(items.find(1).get() == String::fromLatin1("one"));
  CHECK(throws([&] { items.add(std::nan(""), String::fromLatin1("nan")); }));
  // -0 and 0 are one key, as JavaScript's Map has them.
  CHECK(throws([&] { items.add(-0.0, String::fromLatin1("zero")); }) == false);
  CHECK(throws([&] { items.add(0.0, String::fromLatin1("zero again")); }));
}

int main() {
  findsItemsByKey();
  refusesDuplicateAndNaNKeys();

  std::printf("items: %d checks, %d failures\n", checks, failures);

  return failures ? 1 : 0;
}
