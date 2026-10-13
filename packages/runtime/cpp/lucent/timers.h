// Lucent runtime — setTimeout, setInterval and queueMicrotask.
//
// A timer runs its function as a turn of the context that started it (a
// module's actor, the main thread, an executor), after its delay, in the
// order timers fall due and, for equal times, the order they were started
// (HTML's rule). Each belongs to the scope its starter's work belongs to
// (ownedScope: module code's ends with its JavaScript runtime), so a reload
// clears the timers a module left running, as clearTimeout would.
#pragma once

#include "core.h"
#include "function.h"

namespace lucent {

/// `setTimeout(f, ms)` and `setInterval(f, ms)`: `f` after `ms`
/// milliseconds (0 when negative or NaN), once or until cleared. The id is
/// a positive integer, distinct from every other timer's in the process.
double setTimer(Fn<void()> f, double ms, bool repeat);

/// `clearTimeout(id)` and `clearInterval(id)`: a timer that has not run
/// (or an interval) runs no more. Any id, or undefined, is taken: one of
/// no timer does nothing.
void clearTimer(const Opt<double>& id);

/// `queueMicrotask(f)`: `f` after the calling context's current turn and
/// the microtasks queued before it, as a promise's reaction would run.
void queueMicrotask(Fn<void()> f);

/// Timers pending (tests).
size_t pendingTimers();

}  // namespace lucent
