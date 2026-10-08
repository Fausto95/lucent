// Lucent runtime — module code's destroy hooks (lucent:core's onDestroy).
//
// Module state is initialized for each JavaScript runtime and ends with it
// (a reload, the runtime's end). A hook module code registers belongs to
// the module scope current then, and runs when that scope's host is torn
// down: with the Lucent lock held, before a reload initializes the modules
// again, so it still sees the state it belongs to.
#pragma once

#include "function.h"
#include "scope.h"

namespace lucent {

/// `onDestroy(hook)`: runs `hook` when the current module state ends.
/// Returns the function that removes it first; calling that again does
/// nothing.
Fn<void()> onDestroy(Fn<void()> hook);

/// Runs, last registered first, and forgets the hooks registered under
/// `scope`; what one throws is reported, and the others run. With the
/// Lucent lock held (Host's teardown).
void runDestroyHooks(const Scope* scope);

}  // namespace lucent
