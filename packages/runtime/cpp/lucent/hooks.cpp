#include "hooks.h"

#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <vector>

#include "native_root.h"
#include "report.h"
#include "scheduler.h"

namespace lucent {

namespace {

struct Hook {
  uint64_t generation;
  /// The actor the hook's module code ran in (actors are never destroyed).
  Actor* actor;
  uint64_t id;
  Fn<void()> run;
};

struct Hooks {
  std::mutex m;
  std::vector<Hook> list;
  uint64_t next = 0;
};

Hooks& hooks() {
  static auto* h = new Hooks();
  return *h;
}

}  // namespace

Fn<void()> onDestroy(Fn<void()> hook) {
  Hooks& h = hooks();
  Actor* actor = Actor::current();
  uint64_t generation = moduleGeneration();
  uint64_t id = 0;
  {
    std::lock_guard<std::mutex> g(h.m);
    id = ++h.next;
    h.list.push_back(Hook{generation, actor ? actor : &Actor::shared(), id, std::move(hook)});
  }

  return Fn<void()>([id] {
    Hooks& h = hooks();
    std::lock_guard<std::mutex> g(h.m);
    std::erase_if(h.list, [id](const Hook& k) { return k.id == id; });
  });
}

void runDestroyHooks(uint64_t generation) {
  Hooks& h = hooks();
  std::vector<Hook> mine;
  {
    std::lock_guard<std::mutex> g(h.m);
    for (auto it = h.list.begin(); it != h.list.end();) {
      if (it->generation == generation) {
        mine.push_back(std::move(*it));
        it = h.list.erase(it);
      } else {
        ++it;
      }
    }
  }

  for (auto it = mine.rbegin(); it != mine.rend(); ++it) {
    LucentScope lock(*it->actor);
    try {
      it->run();
    } catch (...) {
      reportUncaught(std::current_exception(), "onDestroy");
    }
  }
}

}  // namespace lucent
