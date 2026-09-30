// Lucent runtime — the main thread on hosts without one (tests, tools). iOS
// and Android implement postToMain in lucent/platform.
#include "native.h"

#include <atomic>

#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif

namespace lucent {
namespace {
std::atomic<long> nativeRefs{0};
std::atomic<long> moduleRefs{0};
}  // namespace

long liveNativeRefs() { return nativeRefs.load(); }

long moduleNativeRefs() { return moduleRefs.load(); }

bool detail::countNativeRef() {
  nativeRefs++;

  // Made in the main context: a view's, which the renderer releases with it.
  if (ExecutionContext::current() == &ExecutionContext::main()) return false;

  moduleRefs++;
  return true;
}

void detail::uncountNativeRef(bool module, bool held) {
  if (module) moduleRefs--;
  if (!held) nativeRefs--;
}

void detail::releaseNative(void* handle, void (*release)(void*), ExecutionContext* on, bool module) {
  detail::runOn(on, [handle, release, module] {
    release(handle);
    uncountNativeRef(module);
  });
}
}  // namespace lucent

#if !defined(__ANDROID__) && !(defined(TARGET_OS_IOS) && TARGET_OS_IOS)

namespace lucent {

namespace {

/// The host's stand-in for the platform's main thread: lives for the process.
WorkerThread& hostMainThread() {
  static auto* thread = new std::shared_ptr<WorkerThread>(WorkerThread::start([](Job& job) { detail::runGuarded(job, "job"); }));
  return **thread;
}

}  // namespace

void postToMain(std::function<void()> job) { hostMainThread().post(std::move(job)); }

bool onMainThread() { return hostMainThread().isCurrent(); }

}  // namespace lucent

#endif
