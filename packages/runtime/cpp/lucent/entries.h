// Lucent runtime — native entry points (decision 0091): the C types an
// entry passes, and how a generated entry runs a module function through
// the native root, with no JavaScript runtime.
//
// The generated lucent_entries.h declares an app's entries,
// lucent_<module>_<export>. A synchronous one returns whether it
// succeeded, its error and result written through its last two pointers.
// An async one calls a completion once, from the module's context. Each
// call is a NativeCall (native_root.h): it starts module state if none
// lasts, holds it until it returns or completes, and then cancels the work
// it started that still runs. Lucent owns the strings, bytes and errors it
// passes: a synchronous entry's last until the thread's next entry call, a
// completion's until it returns.
//
// What else crosses (decision 0116), an optional, an array, a record or a
// platform object, is a lucent_value: a kind, and the value of that kind.
// An array's items and a record's keys and values are lucent_values too.
//
// lucent_launch(), which every app's lucent_entries.h declares, starts
// module state at launch when a package lists launch modules (lucent.json's
// `launch`), and does nothing otherwise. iOS's LucentAppDelegate calls it.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// UTF-8, not terminated: `length` bytes from `data`.
typedef struct lucent_string {
  const char* data;
  size_t length;
} lucent_string;

typedef struct lucent_bytes {
  const uint8_t* data;
  size_t length;
} lucent_bytes;

/// An Error Lucent code threw: its name ("RangeError"), message and code
/// (empty without one).
typedef struct lucent_error {
  lucent_string name;
  lucent_string message;
  lucent_string code;
} lucent_error;

/// What a lucent_value holds: LUCENT_NULL for an optional's absent value.
typedef enum lucent_kind {
  LUCENT_NULL = 0,
  LUCENT_BOOLEAN = 1,
  LUCENT_NUMBER = 2,
  LUCENT_BIGINT = 3,
  LUCENT_STRING = 4,
  LUCENT_BYTES = 5,
  LUCENT_ARRAY = 6,
  LUCENT_RECORD = 7,
  /// A platform object: an `id` on iOS, a `jobject` on Android.
  LUCENT_PLATFORM_OBJECT = 8,
} lucent_kind;

typedef struct lucent_value lucent_value;

typedef struct lucent_array {
  const lucent_value* items;
  size_t length;
} lucent_array;

/// A `Record<string, T>`: `length` keys, and the value of each.
typedef struct lucent_record {
  const lucent_string* keys;
  const lucent_value* values;
  size_t length;
} lucent_record;

struct lucent_value {
  lucent_kind kind;
  union {
    bool boolean;
    double number;
    int64_t bigint;
    lucent_string string;
    lucent_bytes bytes;
    lucent_array array;
    lucent_record record;
    void* object;
  } as;
};

#ifdef __cplusplus
}

#include <deque>
#include <exception>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "async.h"
#include "bigint.h"
#include "bytes.h"
#include "array.h"
#include "jserror.h"
#include "jsstring.h"
#include "map.h"
#include "native.h"
#include "native_root.h"
#include "scheduler.h"

namespace lucent::entries {

// --- what crosses -----------------------------------------------------------------

inline String in(lucent_string s) { return String::fromUtf8(std::string_view(s.data ? s.data : "", s.data ? s.length : 0)); }
inline Bytes in(lucent_bytes b) { return b.data && b.length ? Bytes::copy(b.data, b.length) : Bytes(0.0); }
inline BigInt in(int64_t v) { return BigInt::fromInt64(v); }
inline double in(double v) { return v; }
inline bool in(bool v) { return v; }

/// What an entry passes out, kept until its caller is done with it.
class Kept {
 public:
  lucent_string keep(const String& s);
  lucent_string keep(const std::string& s);
  lucent_bytes keep(const Bytes& b);
  /// A platform object, held while it is kept.
  void* keep(const NativeRef& r);
  /// Room for `n` values (an array's items, a record's values), and keys.
  lucent_value* values(size_t n);
  lucent_string* keys(size_t n);
  void clear();

 private:
  // A deque: what earlier keeps point into never moves.
  std::deque<std::string> strings_;
  std::deque<std::vector<uint8_t>> bytes_;
  std::deque<std::vector<lucent_value>> values_;
  std::deque<std::vector<lucent_string>> keys_;
  std::deque<NativeRef> objects_;
};

/// The calling thread's: cleared as a synchronous entry starts.
Kept& threadKept();

inline double out(Kept&, double v) { return v; }
inline bool out(Kept&, bool v) { return v; }
inline lucent_string out(Kept& k, const String& s) { return k.keep(s); }
inline lucent_bytes out(Kept& k, const Bytes& b) { return k.keep(b); }
/// A RangeError past int64_t's range.
inline int64_t out(Kept&, const BigInt& v) { return v.toInt64(); }

// --- lucent_values: optionals, arrays, records and platform objects (0116) ---------
//
// An entry converts each through a converter the compiler composes from its
// type: `arrayIn<double>(numberIn)` reads a `number[]`, and `arrayOut(numberOut)`
// writes one. A value of another kind than its type's is a TypeError, as a
// call from JavaScript with one would be.

/// A platform object an entry is given (an `id`, a `jobject`), as module code holds it; and the
/// one it gives, kept. Defined by the platform's runtime (ios.mm, android.cpp).
NativeRef nativeIn(void* object);
void* nativeOut(Kept& k, const NativeRef& r);

namespace detail {
[[noreturn]] void wrongKind(lucent_kind got, const char* expected);
inline void expect(const lucent_value& v, lucent_kind kind, const char* what) {
  if (v.kind != kind) wrongKind(v.kind, what);
}
}  // namespace detail

inline double numberIn(const lucent_value& v) {
  detail::expect(v, LUCENT_NUMBER, "a number");
  return v.as.number;
}
inline bool booleanIn(const lucent_value& v) {
  detail::expect(v, LUCENT_BOOLEAN, "a boolean");
  return v.as.boolean;
}
inline BigInt bigintIn(const lucent_value& v) {
  detail::expect(v, LUCENT_BIGINT, "a bigint");
  return in(v.as.bigint);
}
inline String stringIn(const lucent_value& v) {
  detail::expect(v, LUCENT_STRING, "a string");
  return in(v.as.string);
}
inline Bytes bytesIn(const lucent_value& v) {
  detail::expect(v, LUCENT_BYTES, "bytes");
  return in(v.as.bytes);
}
inline NativeRef objectIn(const lucent_value& v) {
  detail::expect(v, LUCENT_PLATFORM_OBJECT, "a platform object");
  if (!v.as.object) detail::wrongKind(LUCENT_NULL, "a platform object");
  return nativeIn(v.as.object);
}

/// `T | null` (`null`: what an absent value is), or `T | undefined`.
template <class T, class F>
auto optionalIn(F inner, bool null) {
  return [inner, null](const lucent_value& v) -> Opt<T> {
    if (v.kind == LUCENT_NULL) return null ? Opt<T>(lucent::null) : Opt<T>(undefined);
    return Opt<T>(inner(v));
  };
}

template <class T, class F>
auto arrayIn(F element) {
  return [element](const lucent_value& v) {
    detail::expect(v, LUCENT_ARRAY, "an array");
    Array<T> out;
    for (size_t i = 0; i < v.as.array.length; i++) out.push(element(v.as.array.items[i]));
    return out;
  };
}

template <class T, class F>
auto recordIn(F value) {
  return [value](const lucent_value& v) {
    detail::expect(v, LUCENT_RECORD, "a record");
    Dict<T> out;
    for (size_t i = 0; i < v.as.record.length; i++) out.set(in(v.as.record.keys[i]), value(v.as.record.values[i]));
    return out;
  };
}

inline lucent_value numberOut(Kept&, double d) {
  lucent_value v{LUCENT_NUMBER, {}};
  v.as.number = d;
  return v;
}
inline lucent_value booleanOut(Kept&, bool b) {
  lucent_value v{LUCENT_BOOLEAN, {}};
  v.as.boolean = b;
  return v;
}
/// A RangeError past int64_t's range.
inline lucent_value bigintOut(Kept&, const BigInt& b) {
  lucent_value v{LUCENT_BIGINT, {}};
  v.as.bigint = b.toInt64();
  return v;
}
inline lucent_value stringOut(Kept& k, const String& s) {
  lucent_value v{LUCENT_STRING, {}};
  v.as.string = k.keep(s);
  return v;
}
inline lucent_value bytesOut(Kept& k, const Bytes& b) {
  lucent_value v{LUCENT_BYTES, {}};
  v.as.bytes = k.keep(b);
  return v;
}
inline lucent_value objectOut(Kept& k, const NativeRef& r) {
  lucent_value v{LUCENT_PLATFORM_OBJECT, {}};
  v.as.object = nativeOut(k, r);
  return v;
}

template <class F>
auto optionalOut(F inner) {
  return [inner](Kept& k, const auto& o) -> lucent_value {
    if (!o.has()) return lucent_value{LUCENT_NULL, {}};
    return inner(k, o.get());
  };
}

template <class F>
auto arrayOut(F element) {
  return [element](Kept& k, const auto& a) {
    lucent_value v{LUCENT_ARRAY, {}};
    lucent_value* items = k.values(a.size());
    for (size_t i = 0; i < a.size(); i++) items[i] = element(k, a.at(i));
    v.as.array = lucent_array{items, a.size()};
    return v;
  };
}

template <class F>
auto recordOut(F value) {
  return [value](Kept& k, const auto& d) {
    lucent_value v{LUCENT_RECORD, {}};
    Array<String> names = d.keys();
    lucent_string* keys = k.keys(names.size());
    lucent_value* values = k.values(names.size());
    for (size_t i = 0; i < names.size(); i++) {
      keys[i] = k.keep(names.at(i));
      values[i] = value(k, d.get(names.at(i)).get());
    }
    v.as.record = lucent_record{keys, values, names.size()};
    return v;
  };
}

/// `error` as its C form, its strings kept in `k`.
lucent_error errorOf(Kept& k, const Error& error);

/// The error a throw carries, as Lucent code would catch it.
inline Error caught(std::exception_ptr e) { return currentError(e); }

namespace detail {

/// Holds `actor` for an entry: as callNow does, the main thread taking it in
/// place.
struct EntryScope {
  explicit EntryScope(Actor& actor) {
    if (onMainThread())
      scope.emplace(actor, LucentScope::FromMain{});
    else
      scope.emplace(actor);
  }
  std::optional<LucentScope> scope;
};

}  // namespace detail

/// Starts module state at app launch for an app with launch modules
/// (lucent_launch, decisions 0092 and 0090), running `init` on the calling
/// thread, the main one, and holds it for the process: no reload ends it.
/// Work the modules start then belongs to their actors' roots. A second
/// call does nothing.
void launch(ModuleInitializer init);

/// A synchronous entry: runs `f(kept)` holding `actor`, for a native call
/// that starts module state (`init`) if none lasts and ends as it returns.
/// False, with `error` filled, if it threw.
template <class F>
bool call(ModuleInitializer init, Actor& actor, lucent_error* error, F&& f) {
  Kept& kept = threadKept();
  kept.clear();

  auto native = NativeCall::start();
  ensureModuleState(init);

  bool ok = true;
  {
    NativeCall::Entry entry(*native);
    try {
      detail::EntryScope scope(actor);
      f(kept);
    } catch (...) {
      if (error) *error = errorOf(kept, caught(std::current_exception()));
      ok = false;
    }
  }

  native->end();
  return ok;
}

/// An async entry: `start()` returns the module function's promise,
/// holding `actor`; `done(kept, value, error)` runs once, from the module's
/// context, with a pointer to the settled value (none for `void`) or the
/// error, and the native call ends after it.
template <class T, class Start, class Done>
void callAsync(ModuleInitializer init, Actor& actor, Start&& start, Done done) {
  auto native = NativeCall::start();
  ensureModuleState(init);

  auto fail = [&](std::exception_ptr e) {
    Kept kept;
    lucent_error c = errorOf(kept, caught(e));
    if constexpr (std::is_void_v<T>)
      done(kept, &c);
    else
      done(kept, static_cast<const T*>(nullptr), &c);
    native->end();
  };

  NativeCall::Entry entry(*native);
  try {
    detail::EntryScope scope(actor);
    Promise<T> p = start();
    // Registered in the module's context: the completion runs there.
    p.onSettled([p, native, done]() mutable {
      Kept kept;
      if (p.fulfilled()) {
        if constexpr (std::is_void_v<T>) {
          done(kept, static_cast<const lucent_error*>(nullptr));
        } else {
          T value = p.value();
          done(kept, &value, static_cast<const lucent_error*>(nullptr));
        }
      } else {
        lucent_error c = errorOf(kept, p.error());
        if constexpr (std::is_void_v<T>)
          done(kept, &c);
        else
          done(kept, static_cast<const T*>(nullptr), &c);
      }
      native->end();
    });
  } catch (...) {
    fail(std::current_exception());
  }
}

}  // namespace lucent::entries

#endif  // __cplusplus
