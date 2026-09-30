// Lucent runtime — the Android host of Lucent components in React Native's
// Fabric renderer.
//
// Android mounts views from Java: each component's manager
// (dev.lucent.LucentViewManager) hands its view's commits and commands to
// the C++ host (LucentViewsAndroid.cpp), which does what the iOS host
// (LucentComponentView) does: it parses each commit's props with the
// component's generated Props, mounts the component once a commit is on
// screen (the view attached, or sent a command) on the main thread, with a
// token of its own, hands the mount later commits and commands, and ends
// it when the view is dropped or recycled. Each component's generated glue
// (views/<registration>_android.cpp) provides its Mounted, over the
// component's Mount.
//
// React Native's autolinking registers each component's descriptor wrapped
// in HostDescriptor (ComponentDescriptors.h, written by lucent build, lists
// them through react-native.config.js): Java never hands a view's event
// emitter on, so the descriptor records it by tag as the renderer makes it.
#pragma once

#include <folly/dynamic.h>
#include <react/renderer/core/ComponentDescriptor.h>
#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/core/ShadowNodeFamily.h>

#include <lucent/lucent.h>

#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "LucentViewRequests.h"
#include "LucentViews.h"

namespace lucent::views {

/**
 * One mount of a component on its host view: the component's Lucent side,
 * which generated code implements over its Mount. Main thread.
 */
class Mounted {
 public:
  virtual ~Mounted() = default;

  /// The view the component's setup returned (empty if setup failed).
  virtual NativeRef view() const = 0;

  /// Applies a later commit's props (the component's own Props type).
  virtual void update(const facebook::react::Props& props, const facebook::react::Props& previous) = 0;

  /// Runs command `name`; a request answers through `requester`.
  virtual void command(const std::string& name, const folly::dynamic& args, const Requester& requester) = 0;
};

/** The C++ host of one view (LucentViewsAndroid.cpp). */
struct HostState;

/** What a mount knows of its host view. */
class HostView {
 public:
  HostView() = default;
  HostView(std::weak_ptr<HostState> host, MountToken token) : host_(std::move(host)), token_(token) {}

  const MountToken& token() const { return token_; }

  /// Whether the view still holds this mount (not dropped, recycled or remounted).
  bool current() const;

  /// The view's event emitter while the view holds this mount; else null,
  /// and events are dropped.
  std::shared_ptr<const facebook::react::EventEmitter> emitter() const;

  /// The view the host made for this mount's React children (a component
  /// taking them), while the view holds this mount; else empty.
  NativeRef slot() const;

 private:
  std::weak_ptr<HostState> host_;
  MountToken token_;
};

/** A component as the Android host finds it (views/lucent_hosts.cpp). */
struct AndroidComponent {
  const char* name;
  /// Mounts the component for `props` (its own Props type) on `host`: its setup runs once.
  std::unique_ptr<Mounted> (*mount)(const facebook::react::Props& props, HostView host);
  /// The request id a command carries, if it is a request that parses.
  std::optional<double> (*requestId)(const std::string& name, const folly::dynamic& args);
};

/** Generated: the app's component registered as `name`, or null. */
const AndroidComponent* findComponent(std::string_view name);

/** Binds the natives of dev.lucent.LucentViews, once. */
void installAndroidHost();

/** Where the host finds the descriptor of the component registered as `name`: the latest one. */
void registerDescriptor(const std::string& name, const facebook::react::ComponentDescriptor* descriptor);

/** The descriptor is going (its registry is): unless a newer one replaced it, the host has none. */
void forgetDescriptor(const std::string& name, const facebook::react::ComponentDescriptor* descriptor);

/** The event emitter of view `tag` of `surface`, as the renderer made it. Any thread. */
void recordEmitter(
    facebook::react::SurfaceId surface,
    facebook::react::Tag tag,
    const facebook::react::SharedEventEmitter& emitter);

/**
 * A component's generated descriptor as the Android host registers it:
 * it binds the host's natives before any view exists, lets the host parse
 * props, and records each view's event emitter.
 */
template <typename Descriptor>
class HostDescriptor final : public Descriptor {
 public:
  explicit HostDescriptor(const facebook::react::ComponentDescriptorParameters& parameters)
      : Descriptor(parameters) {
    installAndroidHost();
    registerDescriptor(this->getComponentName(), this);
  }

  ~HostDescriptor() override { forgetDescriptor(this->getComponentName(), this); }

  facebook::react::ShadowNodeFamily::Shared createFamily(
      const facebook::react::ShadowNodeFamilyFragment& fragment) const override {
    auto family = Descriptor::createFamily(fragment);

    recordEmitter(fragment.surfaceId, fragment.tag, family->getEventEmitter());

    return family;
  }
};

}  // namespace lucent::views
