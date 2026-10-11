// Lucent runtime — the native stack's limit: every Lucent function checks
// it on entry, and code that recurses on input (the regular expression
// parser) before it recurses.
//
// Each thread finds its stack's bounds once (pthread attributes) and
// checks a frame's address against the lowest one, minus a margin for the
// frames between two checks and for unwinding. Stacks grow down on every
// platform Lucent targets.
#pragma once

#include <cstddef>
#include <cstdint>

namespace lucent {

/// What every check keeps free below the frame that asks: the frames up to
/// the next check, and the throw that reports the overflow.
inline constexpr size_t kStackMargin = 64 * 1024;

/// Whether the calling thread's stack has less than `need` bytes, plus the
/// margin, left below the caller's frame. False if the bounds are unknown.
bool stackExhausted(size_t need = 0);

namespace detail {

/// The lowest address the calling thread's frames may have before the entry
/// check throws: its stack's limit plus the margin. 0 until the thread first
/// checks; 1 when its bounds are unknown, which never throws.
extern thread_local uintptr_t stackFloor;

/// Finds the calling thread's floor, keeps it in stackFloor and returns it.
uintptr_t findStackFloor() noexcept;

/// JavaScript's RangeError for a full stack: "Maximum call stack size exceeded".
[[noreturn]] void throwStackOverflow();

}  // namespace detail

/// A Lucent function's entry check, as JavaScript engines check each call:
/// a RangeError when the thread's stack has only the margin left, so
/// recursion without end throws, which code may catch, instead of ending
/// the app. A load and a compare when the stack has room (decision 0073);
/// a build defining LUCENT_NO_STACK_CHECK compiles it out.
inline void checkStack() {
#ifndef LUCENT_NO_STACK_CHECK
  uintptr_t floor = detail::stackFloor;
  if (floor == 0) [[unlikely]]
    floor = detail::findStackFloor();
  if (reinterpret_cast<uintptr_t>(__builtin_frame_address(0)) < floor) [[unlikely]]
    detail::throwStackOverflow();
#endif
}

}  // namespace lucent
