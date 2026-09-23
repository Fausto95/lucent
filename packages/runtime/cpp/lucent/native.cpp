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
}
long liveNativeRefs() { return nativeRefs.load(); }
void detail::countNativeRef(int delta) { nativeRefs += delta; }
}  // namespace lucent

#if !defined(__ANDROID__) && !(defined(TARGET_OS_IOS) && TARGET_OS_IOS)

#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>

namespace lucent {

namespace {

class HostMainThread {
 public:
  static HostMainThread& instance() {
    static HostMainThread* t = new HostMainThread();  // lives for the process
    return *t;
  }
  void post(std::function<void()> job) {
    {
      std::lock_guard<std::mutex> g(m_);
      jobs_.push_back(std::move(job));
    }
    cv_.notify_one();
  }
  bool current() const { return std::this_thread::get_id() == id_; }

 private:
  HostMainThread() {
    std::thread t([this] { run(); });
    id_ = t.get_id();
    t.detach();
  }
  void run() {
    for (;;) {
      std::function<void()> job;
      {
        std::unique_lock<std::mutex> g(m_);
        cv_.wait(g, [this] { return !jobs_.empty(); });
        job = std::move(jobs_.front());
        jobs_.pop_front();
      }
      job();
    }
  }
  std::mutex m_;
  std::condition_variable cv_;
  std::deque<std::function<void()>> jobs_;
  std::thread::id id_;
};

}  // namespace

void postToMain(std::function<void()> job) { HostMainThread::instance().post(std::move(job)); }
bool onMainThread() { return HostMainThread::instance().current(); }

}  // namespace lucent

#endif
