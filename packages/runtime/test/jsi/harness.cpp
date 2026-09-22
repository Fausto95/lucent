// Test host: runs JavaScript in Hermes with Lucent modules installed, the way
// the React Native TurboModule does on device.
//
//   harness <script.js>...
//
// Globals available to scripts:
//   __lucent            object with every registered Lucent module
//   print(...args)      writes a line to stdout
//   __reference         undefined unless a reference script defines it
//
// The event loop runs JS tasks posted by Lucent, Hermes microtasks and
// timers until nothing is pending.
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <fstream>
#include <iostream>
#include <mutex>
#include <sstream>

#include "lucent/jsi/convert.h"
#include "lucent/jsi/host.h"

namespace jsi = facebook::jsi;
using lucent::js::Host;
using lucent::js::JsTask;

namespace {

std::mutex queueMutex;
std::condition_variable queueCv;
std::deque<JsTask> queue;

void post(JsTask task) {
  {
    std::lock_guard<std::mutex> g(queueMutex);
    queue.push_back(std::move(task));
  }
  queueCv.notify_one();
}

struct Timer {
  std::chrono::steady_clock::time_point at;
  std::shared_ptr<jsi::Function> fn;
};
std::vector<Timer> timers;

std::string readFile(const char* path) {
  std::ifstream in(path);
  if (!in) {
    std::fprintf(stderr, "cannot read %s\n", path);
    std::exit(2);
  }
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

bool runLoop(jsi::Runtime& rt, double timeoutMs) {
  auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(static_cast<int64_t>(timeoutMs));
  for (;;) {
    rt.drainMicrotasks();
    JsTask task;
    {
      std::unique_lock<std::mutex> g(queueMutex);
      if (!queue.empty()) {
        task = std::move(queue.front());
        queue.pop_front();
      }
    }
    if (task) {
      task(rt);
      continue;
    }
    auto now = std::chrono::steady_clock::now();
    bool ranTimer = false;
    for (size_t i = 0; i < timers.size(); i++) {
      if (timers[i].at <= now) {
        auto fn = timers[i].fn;
        timers.erase(timers.begin() + static_cast<std::ptrdiff_t>(i));
        fn->call(rt);
        ranTimer = true;
        break;
      }
    }
    if (ranTimer) continue;
    bool lucentIdle = lucent::Scheduler::instance().pendingWork() == 0;
    if (lucentIdle && timers.empty()) {
      // Give in-flight posts a moment to land.
      std::unique_lock<std::mutex> g(queueMutex);
      if (queue.empty() && !queueCv.wait_for(g, std::chrono::milliseconds(20), [] { return !queue.empty(); })) {
        if (lucent::Scheduler::instance().pendingWork() == 0) return true;
      }
      continue;
    }
    if (now > deadline) return false;
    std::unique_lock<std::mutex> g(queueMutex);
    queueCv.wait_for(g, std::chrono::milliseconds(1));
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: harness <script.js>...\n");
    return 2;
  }
  auto config = ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build();
  std::unique_ptr<jsi::Runtime> runtime = facebook::hermes::makeHermesRuntime(config);
  jsi::Runtime& rt = *runtime;
  int status = 0;
  {
    std::shared_ptr<Host> host = Host::create(rt, post);
    rt.global().setProperty(rt, "__lucent", host->modules(rt));
    rt.global().setProperty(
        rt, "print",
        jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "print"), 1,
                                              [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                                                std::string line;
                                                for (size_t i = 0; i < n; i++) {
                                                  if (i) line += " ";
                                                  line += args[i].toString(rt).utf8(rt);
                                                }
                                                std::printf("%s\n", line.c_str());
                                                std::fflush(stdout);
                                                return jsi::Value::undefined();
                                              }));
    rt.global().setProperty(
        rt, "setTimeout",
        jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "setTimeout"), 2,
                                              [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                                                double ms = n > 1 && args[1].isNumber() ? args[1].getNumber() : 0;
                                                timers.push_back(Timer{std::chrono::steady_clock::now() + std::chrono::microseconds(static_cast<int64_t>(ms * 1000)),
                                                                       std::make_shared<jsi::Function>(args[0].getObject(rt).getFunction(rt))});
                                                return jsi::Value::undefined();
                                              }));
    try {
      for (int i = 1; i < argc; i++) {
        rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(readFile(argv[i])), argv[i]);
        if (!runLoop(rt, 20000)) {
          std::fprintf(stderr, "timed out waiting for pending work\n");
          status = 3;
        }
      }
      jsi::Value failures = rt.global().getProperty(rt, "__failures");
      if (failures.isNumber() && failures.getNumber() > 0) status = 1;
    } catch (const jsi::JSError& e) {
      std::fprintf(stderr, "Uncaught JS error: %s\n%s\n", e.getMessage().c_str(), e.getStack().c_str());
      status = 1;
    }
    timers.clear();
    {
      std::lock_guard<std::mutex> g(queueMutex);
      queue.clear();
    }
    host->invalidate();
  }
  rt.global().setProperty(rt, "__lucentHost", jsi::Value::undefined());
  runtime.reset();
  return status;
}
