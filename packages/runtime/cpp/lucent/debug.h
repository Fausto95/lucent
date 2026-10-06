// Lucent runtime — what a debug build reports of the runtime (T61): the
// live count of each kind of thing it owns. A view's mounts and their
// native view trees are ui_debug.h's.
#pragma once

#include "live.h"
#include "native.h"

namespace lucent::debug {

struct Resources {
  long nativeRefs = 0;
  long scopes = 0;
  /// Operations alive: pending, or settled and still held.
  long operations = 0;
  long resources = 0;
  /// A view's reactive graph: effects, signals and computed values.
  long effects = 0;
  long signals = 0;
  long computeds = 0;
};

inline Resources resources() {
  using live::Kind;

  return {
      .nativeRefs = liveNativeRefs(),
      .scopes = live::count(Kind::Scope),
      .operations = live::count(Kind::Operation),
      .resources = live::count(Kind::Resource),
      .effects = live::count(Kind::Effect),
      .signals = live::count(Kind::Signal),
      .computeds = live::count(Kind::Computed),
  };
}

}  // namespace lucent::debug
