// Lucent runtime — a component's view as a module function gets it (T124,
// decision 0120): lucent:ui's ComponentView, the mount a component's ref
// named when JavaScript passed it, and the hosts' record of their mounts'
// root views, which lucent:ios's and lucent:android's viewOf read on the
// main thread.
//
// A host records a mount as its setup returns and forgets it as the mount
// ends. A ComponentView names a mount, not a tag: once its mount has ended,
// the view the tag holds next (the next runtime's after a reload) is not
// it, and viewOf throws InvalidStateError. A ref passed before its view
// mounted (an effect right after React's commit, which reaches the main
// thread later) names the tag's first mount.
#pragma once

#include <cstdint>
#include <optional>

#include "jsstring.h"
#include "native.h"

namespace lucent::ui {

/// A mount as its host names it: its view's React tag, and the generation
/// that tells this mount from the tag's next (rn/LucentViews.h's MountToken).
struct MountId {
  double tag = 0;
  std::uint64_t generation = 0;

  bool operator==(const MountId&) const = default;
};

}  // namespace lucent::ui

namespace lucent {

/// lucent:ui's ComponentView (lucent::ui::ComponentView too): the mount a
/// component's ref named, or for a ref passed before its view mounted
/// (generation 0), the tag's first. In lucent with its equality, which the
/// runtime's templates (equality.h) find by argument-dependent lookup and
/// generated code calls as lucent::strictEquals: an overload in lucent::ui
/// would hide lucent's from lucent::ui's own calls (reactive.h's sameValue).
struct ComponentView {
  ui::MountId mount;
};

// As JavaScript has the ref: an object, the same while its mount is.
inline bool strictEquals(const ComponentView& a, const ComponentView& b) { return a.mount == b.mount; }
inline String toJsString(const ComponentView&) { return String::fromLatin1("[object Object]"); }

namespace ui {

using lucent::ComponentView;

/// A host's mount whose setup returned `root` (its view; on Android, the
/// shell for a Fragment root). Main thread.
void recordMount(MountId mount, NativeRef root);

/// The mount has ended: its root is no longer anyone's. Main thread.
void forgetMount(MountId mount);

/// The mount of the component whose view has `tag` now, if one is mounted. Any thread.
std::optional<MountId> mountAt(double tag);

/// The root view of `view`'s mount, on the main thread: an
/// InvalidStateError once that mount has ended, or off the main thread.
NativeRef viewOf(const ComponentView& view);

}  // namespace ui
}  // namespace lucent
