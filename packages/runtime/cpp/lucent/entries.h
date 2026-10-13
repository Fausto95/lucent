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
#include "jserror.h"
#include "jsstring.h"
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
  void clear();

 private:
  // A deque: what earlier keeps point into never moves.
  std::deque<std::string> strings_;
  std::deque<std::vector<uint8_t>> bytes_;
};

/// The calling thread's: cleared as a synchronous entry starts.
Kept& threadKept();

inline double out(Kept&, double v) { return v; }
inline bool out(Kept&, bool v) { return v; }
inline lucent_string out(Kept& k, const String& s) { return k.keep(s); }
inline lucent_bytes out(Kept& k, const Bytes& b) { return k.keep(b); }
/// A RangeError past int64_t's range.
inline int64_t out(Kept&, const BigInt& v) { return v.toInt64(); }

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
