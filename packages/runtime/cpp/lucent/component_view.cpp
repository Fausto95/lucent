#include "component_view.h"

#include <map>
#include <mutex>
#include <utility>

#include "execution.h"
#include "jserror.h"

namespace lucent::ui {

namespace {

struct Recorded {
  std::uint64_t generation = 0;
  /// Main thread only: made, read and released there.
  NativeRef root;
};

/// The mounted components' roots, by tag. Never destroyed: views may outlive static destruction.
struct Mounts {
  std::mutex lock;
  std::map<double, Recorded> byTag;
};

Mounts& mounts() {
  static auto* state = new Mounts();
  return *state;
}

[[noreturn]] void invalidState(const char* why) {
  throwError(String::fromLatin1("InvalidStateError"), String::fromLatin1(why));
}

}  // namespace

void recordMount(MountId mount, NativeRef root) {
  auto& m = mounts();
  NativeRef previous;
  {
    std::lock_guard<std::mutex> held(m.lock);
    auto& at = m.byTag[mount.tag];
    previous = std::exchange(at.root, std::move(root));
    at.generation = mount.generation;
  }
}

void forgetMount(MountId mount) {
  auto& m = mounts();
  NativeRef root;
  {
    std::lock_guard<std::mutex> held(m.lock);
    auto found = m.byTag.find(mount.tag);
    // The tag's next mount may have been recorded already.
    if (found == m.byTag.end() || found->second.generation != mount.generation) return;
    root = std::move(found->second.root);
    m.byTag.erase(found);
  }
}

std::optional<MountId> mountAt(double tag) {
  auto& m = mounts();
  std::lock_guard<std::mutex> held(m.lock);
  auto found = m.byTag.find(tag);

  return found == m.byTag.end() ? std::nullopt : std::optional<MountId>(MountId{tag, found->second.generation});
}

NativeRef viewOf(const ComponentView& view) {
  if (!onMainThread()) invalidState("A component's view is read on the main thread alone: inside main()");

  auto& m = mounts();
  std::lock_guard<std::mutex> held(m.lock);
  auto found = m.byTag.find(view.mount.tag);

  if (found == m.byTag.end() || (view.mount.generation && found->second.generation != view.mount.generation))
    invalidState("The component's view is not mounted");

  return found->second.root;
}

}  // namespace lucent::ui
