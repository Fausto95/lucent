#include "hooks.h"

#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <vector>

#include "execution.h"
#include "report.h"

namespace lucent {

namespace {

struct Hook {
  // Held, so its address names no other scope while the hook waits.
  std::shared_ptr<Scope> scope;
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
  auto scope = moduleScope();
  uint64_t id = 0;
  {
    std::lock_guard<std::mutex> g(h.m);
    id = ++h.next;
    h.list.push_back(Hook{std::move(scope), id, std::move(hook)});
  }

  return Fn<void()>([id] {
    Hooks& h = hooks();
    std::lock_guard<std::mutex> g(h.m);
    std::erase_if(h.list, [id](const Hook& k) { return k.id == id; });
  });
}

void runDestroyHooks(const Scope* scope) {
  Hooks& h = hooks();
  std::vector<Hook> mine;
  {
    std::lock_guard<std::mutex> g(h.m);
    for (auto it = h.list.begin(); it != h.list.end();) {
      if (it->scope.get() == scope) {
        mine.push_back(std::move(*it));
        it = h.list.erase(it);
      } else {
        ++it;
      }
    }
  }

  for (auto it = mine.rbegin(); it != mine.rend(); ++it) {
    try {
      it->run();
    } catch (...) {
      reportUncaught(std::current_exception(), "onDestroy");
    }
  }
}

}  // namespace lucent
