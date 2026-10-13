// Lucent runtime — module code's destroy hooks (lucent:core's onDestroy).
//
// A hook belongs to the generation of module state lasting when it is
// registered (native_root.h), whoever registers it, and runs when that
// generation ends: in the last runtime's teardown, holding its actor,
// before a reload initializes the modules again, so it still sees the
// state it belongs to. A process that ends runs none.
#pragma once

#include <cstdint>

#include "function.h"

namespace lucent {

/// `onDestroy(hook)`: runs `hook` when the current module state ends.
/// Returns the function that removes it first; calling that again does
/// nothing.
Fn<void()> onDestroy(Fn<void()> hook);

/// Runs, last registered first, and forgets the hooks registered under
/// `generation`, each holding the actor that registered it; what one
/// throws is reported, and the others run. Holding no actor (the end of a
/// generation, endModuleStateUnlessHeld).
void runDestroyHooks(uint64_t generation);

}  // namespace lucent
