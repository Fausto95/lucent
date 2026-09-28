// Lucent runtime — the Android host of Lucent components (see
// LucentViewsAndroid.h). Built into Android apps whose Lucent code has
// components (their Fabric sources are generated).
#if defined(__ANDROID__) && __has_include(<views/lucent_views.h>)

#include "LucentViewsAndroid.h"
#include "LucentViewRegistry.h"
#include "LucentViewSizing.h"
#include "LucentViewSlots.h"

#include <fbjni/fbjni.h>
#include <react/jni/NativeArray.h>
#include <react/fabric/StateWrapperImpl.h>
#include <react/jni/NativeMap.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/utils/ContextContainer.h>

#include <lucent/platform/android.h>
#include <lucent/report.h>
#include <lucent/view.h>

#include <exception>
#include <iterator>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>

namespace lucent::views {

using facebook::react::ComponentDescriptor;
using facebook::react::EventEmitter;
using facebook::react::Props;
using facebook::react::SurfaceId;
using facebook::react::Tag;

/**
 * One Java view's host: the props of its latest commit and of the one its
 * mount has, and the mount, once a commit is on screen. Main thread; the
 * Java view holds it (a heap shared_ptr) until it is dropped.
 */
struct HostState {
  std::string name;
  const AndroidComponent* component = nullptr;
  Tag tag = 0;
  SurfaceId surface = 0;
  /// The LucentHostView (a weak global reference).
  jweak view = nullptr;
  Props::Shared committed;
  Props::Shared applied;
  std::unique_ptr<Mounted> mounted;
  /// A zero generation while the view holds no mount.
  MountToken token;
  std::shared_ptr<const EventEmitter> emitter;
  HostSizing sizing;
  /// The mount's slot (dev.lucent.LucentSlotView), for a component taking React children.
  NativeRef slot;
  /// Where the slot is, as the shadow tree lays the children out (LucentViewSlots.h).
  HostSlot place;
};

bool HostView::current() const {
  auto host = host_.lock();

  return host && token_.generation != 0 && host->token == token_;
}

std::shared_ptr<const EventEmitter> HostView::emitter() const {
  auto host = host_.lock();

  return host && token_.generation != 0 && host->token == token_ ? host->emitter : nullptr;
}

NativeRef HostView::slot() const {
  auto host = host_.lock();

  return host && token_.generation != 0 && host->token == token_ ? host->slot : NativeRef();
}

namespace {

// --- what the renderer tells the host (its threads) --------------------------------------

std::mutex& registryMutex() {
  static std::mutex m;
  return m;
}

std::unordered_map<std::string, const ComponentDescriptor*>& descriptors() {
  static auto* map = new std::unordered_map<std::string, const ComponentDescriptor*>();
  return *map;
}

ViewRegistry<const EventEmitter>& emitters() {
  static auto* registry = new ViewRegistry<const EventEmitter>();
  return *registry;
}

// --- one view's host (the main thread) ---------------------------------------------------

/**
 * Runs `work`, reporting what it throws as `where`: nothing escapes into
 * Java. A mount's entry points enter Lucent's main context themselves.
 */
template <class F>
void guarded(const char* where, F&& work) {
  try {
    work();
  } catch (...) {
    reportUncaught(std::current_exception(), where);
  }
}

std::shared_ptr<HostState>& hostOf(jlong handle) { return *reinterpret_cast<std::shared_ptr<HostState>*>(handle); }

/** The props of `host`'s latest commit with `changes` (a commit's) applied, as the component's Props. */
Props::Shared applied(const HostState& host, folly::dynamic changes) {
  static const facebook::react::ContextContainer context;
  facebook::react::PropsParserContext parser{host.surface, context};

  // Held while parsing: the descriptor's registry is not torn down meanwhile.
  std::lock_guard<std::mutex> g(registryMutex());
  auto found = descriptors().find(host.name);

  if (found == descriptors().end()) throw Mismatch("no descriptor is registered for " + host.name);

  return found->second->cloneProps(parser, host.committed, facebook::react::RawProps(std::move(changes)));
}

/** The shell's method `name` (`signature`). */
jmethodID shellMethod(const char* name, const char* signature) {
  return jni::method(jni::findClass("dev/lucent/LucentHostView"), name, signature);
}

/** Shows the mount's view in the host's shell: a setup run again may have returned another. */
void show(HostState& host) {
  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  jobject view = env->NewLocalRef(host.view);

  if (!view) return;

  static jmethodID setContent = shellMethod("setContent", "(Landroid/view/View;)V");

  env->CallVoidMethod(view, setContent, host.mounted ? jni::unwrap(host.mounted->view()) : nullptr);
  jni::check(env);
}

/** The size of the content `host`'s shell shows within `constraints`, or nothing without one. */
std::optional<sizing::Size> measured(const HostState& host, sizing::Constraints constraints) {
  if (!host.mounted) return std::nullopt;

  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  jobject view = env->NewLocalRef(host.view);

  if (!view) return std::nullopt;

  static jmethodID measureContent = shellMethod("measureContent", "(FF)[F");
  auto size = static_cast<jfloatArray>(
      env->CallObjectMethod(view, measureContent, constraints.maxWidth, constraints.maxHeight));

  jni::check(env);

  if (!size) return std::nullopt;

  jfloat values[2];

  env->GetFloatArrayRegion(size, 0, 2, values);

  return sizing::Size{values[0], values[1]};
}

/** Pixels per density-independent pixel, as the shell's resources say. */
float density(const HostState& host) {
  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  jobject view = env->NewLocalRef(host.view);

  if (!view) return 1;

  static jmethodID method = shellMethod("density", "()F");
  float out = env->CallFloatMethod(view, method);

  jni::check(env);

  return out;
}

/** A new slot for the mount's React children, if the component takes them; else empty. */
NativeRef makeSlot(const HostState& host) {
  JNIEnv* env = jni::env();
  jni::LocalFrame frame(env);
  jobject view = env->NewLocalRef(host.view);

  if (!view) return {};

  static jmethodID method = shellMethod("makeSlot", "()Landroid/view/ViewGroup;");
  jobject slot = env->CallObjectMethod(view, method);

  jni::check(env);

  return slot ? jni::wrap(env, slot, "the slot of a component's children") : NativeRef();
}

/** A commit reached the screen (or JavaScript sent the view a command): the component sets up. */
void mount(const std::shared_ptr<HostState>& host) {
  if (host->mounted || !host->committed || !host->component) return;

  host->token = MountToken{host->tag, nextGeneration()};

  auto scale = density(*host);

  // The host holds its sizing: the host outlives it.
  host->sizing.start(scale, host->tag, [raw = host.get()](sizing::Constraints constraints) {
    return measured(*raw, constraints);
  });
  host->place.start(scale, host->tag);
  host->slot = makeSlot(*host);
  host->emitter = emitters().find(host->surface, host->tag);

  if (!host->emitter) logError(("[lucent] " + host->name + " has no event emitter: its events are dropped").c_str());

  guarded("a component's setup", [&] {
    ui::ContentEntry entry(host->sizing.content());
    JNIEnv* env = jni::env();
    jni::LocalFrame frame(env);
    // What setup makes for the shell takes its context (a Compose body's view).
    jni::HostViewEntry hosting(env->NewLocalRef(host->view));

    host->mounted = host->component->mount(*host->committed, HostView(host, host->token));
  });

  host->applied = host->committed;
  show(*host);
  // Measured once the shell shows the content.
  host->sizing.measure();
}

// --- the natives -------------------------------------------------------------------------

jlong update(JNIEnv* env, jclass, jlong handle, jobject view, jstring name, jint tag, jint surface, jobject props) {
  if (!handle) {
    auto host = std::make_shared<HostState>();

    host->name = jni::fromJString(env, name, "component").toUtf8();
    host->component = findComponent(host->name);
    host->tag = tag;
    host->surface = surface;
    host->view = env->NewWeakGlobalRef(view);

    if (!host->component) logError(("[lucent] no Lucent code is compiled for the component " + host->name).c_str());

    handle = reinterpret_cast<jlong>(new std::shared_ptr<HostState>(std::move(host)));
  }

  auto& host = hostOf(handle);

  try {
    auto map = facebook::jni::wrap_alias(static_cast<facebook::react::NativeMap::javaobject>(props));

    host->committed = applied(*host, map->cthis()->consume());
  } catch (...) {
    reportUncaught(std::current_exception(), host->name.c_str());
    return handle;
  }

  if (host->mounted && host->committed != host->applied) {
    auto previous = host->applied;

    // The commit, whole, to the mount: setup does not run again.
    guarded("a component's update", [&] {
      ui::ContentEntry entry(host->sizing.content());

      host->mounted->update(*host->committed, *previous);
    });

    host->applied = host->committed;
    host->place.contentChanged();
  }

  return handle;
}

void state(JNIEnv*, jclass, jlong handle, jobject wrapper) {
  if (!handle || !wrapper) return;

  auto& host = hostOf(handle);
  auto impl = facebook::jni::wrap_alias(static_cast<facebook::react::StateWrapperImpl::javaobject>(wrapper));

  auto state = impl->cthis()->getState();

  host->sizing.setState(state);
  host->sizing.measure();
  host->place.setState(state);
}

void contentChanged(JNIEnv*, jclass, jlong handle) {
  if (!handle) return;

  hostOf(handle)->sizing.contentChanged();
}

/** The slot's place and the content box, in the shell's pixels (x, y, width, height each). */
void slotPlaced(JNIEnv* env, jclass, jlong handle, jintArray place, jboolean rtl, jboolean swapped) {
  if (!handle || !place) return;

  auto& host = hostOf(handle);
  jint px[8];

  env->GetIntArrayRegion(place, 0, 8, px);

  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    logError("[lucent] a slot's place came without its eight values");
    return;
  }

  auto scale = density(*host);
  auto rect = [&](int at) {
    return slots::Rect{px[at] / scale, px[at + 1] / scale, px[at + 2] / scale, px[at + 3] / scale};
  };

  host->place.place(slots::insetsOf(rect(0), rect(4)), rtl, swapped);
}

void attach(JNIEnv*, jclass, jlong handle) {
  if (handle) mount(hostOf(handle));
}

void command(JNIEnv* env, jclass, jlong handle, jstring name, jobject args) {
  if (!handle) return;

  auto host = hostOf(handle);
  auto sent = jni::fromJString(env, name, "command").toUtf8();
  auto list = facebook::jni::wrap_alias(static_cast<facebook::react::NativeArray::javaobject>(args));
  folly::dynamic arguments = list->cthis()->consume();
  auto requester = Requester::current();

  // React sends a command once the view is committed, which may be before it is attached.
  mount(host);

  if (!host->mounted) {
    std::string problem = "command " + sent + " reached a view with no mount (its setup failed)";

    // A request would otherwise never settle while the view stays.
    auto id = host->component ? host->component->requestId(sent, arguments) : std::nullopt;

    if (id)
      requester.reject(*id, problem);
    else
      logError(("[lucent] " + problem).c_str());

    return;
  }

  guarded("a component's command", [&] {
    ui::ContentEntry entry(host->sizing.content());

    host->mounted->command(sent, arguments, requester);
  });

  // A command may move the slot.
  host->place.contentChanged();
}

void drop(JNIEnv* env, jclass, jlong handle) {
  if (!handle) return;

  auto* held = reinterpret_cast<std::shared_ptr<HostState>*>(handle);
  auto host = std::move(*held);

  delete held;

  // A recycled shell's next occupant gets a mount (and token, and slot) of its own.
  host->token = MountToken{};
  host->slot = NativeRef();
  // Its teardown runs the mount's code: nothing to measure any more.
  host->sizing.stop();

  auto mounted = std::move(host->mounted);

  guarded("a component's teardown", [&] { mounted.reset(); });

  env->DeleteWeakGlobalRef(host->view);
}

void report(JNIEnv* env, jclass, jstring message) {
  logError(jni::fromJString(env, message, "message").toUtf8().c_str());
}

}  // namespace

void installAndroidHost() {
  static std::once_flag once;

  std::call_once(once, [] {
    JNIEnv* env = jni::env();
    JNINativeMethod natives[] = {
        {const_cast<char*>("update"),
         const_cast<char*>("(JLdev/lucent/LucentHostView;Ljava/lang/String;IILcom/facebook/react/bridge/NativeMap;)J"),
         reinterpret_cast<void*>(update)},
        {const_cast<char*>("attach"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(attach)},
        {const_cast<char*>("state"), const_cast<char*>("(JLcom/facebook/react/uimanager/StateWrapper;)V"),
         reinterpret_cast<void*>(state)},
        {const_cast<char*>("contentChanged"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(contentChanged)},
        {const_cast<char*>("slotPlaced"), const_cast<char*>("(J[IZZ)V"), reinterpret_cast<void*>(slotPlaced)},
        {const_cast<char*>("command"), const_cast<char*>("(JLjava/lang/String;Lcom/facebook/react/bridge/NativeArray;)V"),
         reinterpret_cast<void*>(command)},
        {const_cast<char*>("drop"), const_cast<char*>("(J)V"), reinterpret_cast<void*>(drop)},
        {const_cast<char*>("report"), const_cast<char*>("(Ljava/lang/String;)V"), reinterpret_cast<void*>(report)},
    };

    env->RegisterNatives(jni::findClass("dev/lucent/LucentViews"), natives, std::size(natives));
    jni::check(env);
  });
}

void registerDescriptor(const std::string& name, const ComponentDescriptor* descriptor) {
  std::lock_guard<std::mutex> g(registryMutex());

  descriptors()[name] = descriptor;
}

void forgetDescriptor(const std::string& name, const ComponentDescriptor* descriptor) {
  std::lock_guard<std::mutex> g(registryMutex());
  auto found = descriptors().find(name);

  if (found != descriptors().end() && found->second == descriptor) descriptors().erase(found);
}

void recordEmitter(SurfaceId surface, Tag tag, const facebook::react::SharedEventEmitter& emitter) {
  emitters().record(surface, tag, emitter);
}

}  // namespace lucent::views

#endif  // __ANDROID__ && views
