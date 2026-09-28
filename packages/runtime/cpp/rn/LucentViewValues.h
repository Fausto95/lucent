// Lucent runtime — a component's values between its host and its Lucent
// code: the props a commit holds and a command's arguments become Lucent
// values, event arguments and a request's answer come back as the plain
// values the renderer's side holds (LucentViews.h).
//
// Plain C++ over Lucent's runtime: both platform hosts' generated code uses
// it.
#pragma once

#include <lucent/lucent.h>

#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace lucent::views {

// --- to Lucent ---------------------------------------------------------------------------

inline String lucentString(const std::string& utf8) { return String::fromUtf8(utf8); }

template <class L, class R, class F>
Array<L> lucentArray(const std::vector<R>& items, F&& each) {
  Array<L> out;

  for (const auto& item : items) out.push(L(each(item)));

  return out;
}

/** A nullable value: null, or `each` of it. */
template <class L, class R, class F>
Opt<L> lucentNullable(const std::optional<R>& value, F&& each) {
  if (!value) return Opt<L>(null);

  return Opt<L>(L(each(*value)));
}

/**
 * A value that may be missing: undefined, or `each` of it (which may itself
 * be an Opt, for a nullable value).
 */
template <class L, class R, class F>
Opt<L> lucentOptional(const std::optional<R>& value, F&& each) {
  if (!value) return Opt<L>(undefined);

  if constexpr (IsOpt<std::decay_t<decltype(each(*value))>>::value)
    return each(*value);
  else
    return Opt<L>(L(each(*value)));
}

/** A value the component requires: a TypeError when the commit lacks it. */
template <class R>
const R& required(const std::optional<R>& value, const char* what) {
  if (!value) throwTypeError((std::string(what) + " is missing").c_str());

  return *value;
}

// --- from Lucent -------------------------------------------------------------------------

inline std::string utf8(const String& value) { return value.toUtf8(); }

/** Fills `out` with `value`'s elements, each through `each(target, element)`. */
template <class R, class L, class F>
void assignArray(std::vector<R>& out, const Array<L>& value, F&& each) {
  out.clear();
  out.reserve(value.size());

  for (size_t i = 0; i < value.size(); ++i) {
    out.emplace_back();
    each(out.back(), value.at(i));
  }
}

/** `out` empty when `value` is absent (undefined or null), else `each(target, value)`. */
template <class R, class L, class F>
void assignOpt(std::optional<R>& out, const Opt<L>& value, F&& each) {
  if (!value.has()) {
    out.reset();
    return;
  }

  out.emplace();
  each(*out, value.get());
}

/**
 * A value that may be missing and may be null: `out` empty when undefined,
 * holding an empty value when null.
 */
template <class R, class L, class F>
void assignOptionalNullable(std::optional<std::optional<R>>& out, const Opt<L>& value, F&& each) {
  if (value.isUndefined()) {
    out.reset();
    return;
  }

  out.emplace();

  if (value.has()) {
    out->emplace();
    each(**out, value.get());
  }
}

/** The message of what Lucent code threw, for a rejected request. */
inline std::string thrownMessage(std::exception_ptr thrown) {
  try {
    std::rethrow_exception(thrown);
  } catch (const Exception& e) {
    return e.error() ? e.error()->message.toUtf8() : e.what();
  } catch (const std::exception& e) {
    return e.what();
  } catch (...) {
    return "an unknown error";
  }
}

inline std::string errorMessage(const Error& error) { return error ? error->message.toUtf8() : "an unknown error"; }

}  // namespace lucent::views
