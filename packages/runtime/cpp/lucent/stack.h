// Lucent runtime — the native stack's limit, for code that recurses on
// input (the regular expression parser).
//
// Each thread finds its stack's bounds once (pthread attributes) and
// checks a frame's address against the lowest one, minus a margin for the
// frames between two checks and for unwinding. Stacks grow down on every
// platform Lucent targets.
#pragma once

#include <cstddef>

namespace lucent {

/// What every check keeps free below the frame that asks: the frames up to
/// the next check, and the throw that reports the overflow.
inline constexpr size_t kStackMargin = 64 * 1024;

/// Whether the calling thread's stack has less than `need` bytes, plus the
/// margin, left below the caller's frame. False if the bounds are unknown.
bool stackExhausted(size_t need = 0);

}  // namespace lucent
