// Runs the package's iOS module on the macOS host, without JavaScript: calls
// its exports on the Lucent context and prints how each promise settles.
// The orb (WLZOrb.m) reports from a dispatch queue of its own.
#include <chrono>
#include <cstdio>
#include <future>
#include <memory>
#include <string>

#include "lucent/lucent.h"
#include "m_wlz_u2d_pulses_u2f_pulses.h"

using namespace lucent;
namespace pulses = lucent_app::m_wlz_u2d_pulses_u2f_pulses;

static std::string text(double v) { return toJsString(v).toUtf8(); }

static std::string text(const String& s) { return s.toUtf8(); }

/// Calls `start` on the Lucent context and waits for its promise.
template <class T, class Start>
static std::string settled(Start start) {
  auto out = std::make_shared<std::promise<std::string>>();
  auto future = out->get_future();

  {
    LucentScope scope;
    Promise<T> p = start();

    p.onSettled([p, out] {
      out->set_value(p.fulfilled() ? "resolved " + text(p.value())
                                   : "rejected " + p.error()->name.toUtf8() + ": " + p.error()->message.toUtf8());
    });
  }

  if (future.wait_for(std::chrono::seconds(10)) != std::future_status::ready) return "timed out";

  return future.get();
}

int main() {
  {
    LucentScope scope;
    pulses::init();
  }

  std::printf("%s\n", settled<double>([] { return pulses::firstPulse(3, undefined); }).c_str());
  std::printf("%s\n", settled<String>([] { return pulses::pulsesUntilBroken(4); }).c_str());
  std::printf("%s\n", settled<String>([] { return pulses::pulsesUntilAborted(3); }).c_str());
  std::printf("%s\n", settled<double>([] {
                        AbortController c = std::make_shared<AbortControllerObject>();
                        c->abort(undefined);
                        return pulses::firstPulse(3, c->signal);
                      }).c_str());

  return 0;
}
