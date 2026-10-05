#include "view.h"

#include <string>
#include <utility>
#include <vector>

#include "execution.h"
#include "report.h"

namespace lucent::ui {

std::shared_ptr<Graph> mainGraph() {
  // Never destroyed, as the main context is not: nothing disposes at exit.
  static auto* graph = new std::shared_ptr<Graph>(Graph::create(ExecutionContext::main()));

  return *graph;
}

void reportViewError(std::exception_ptr error, const char* component, const char* what, const char* source) {
  std::string where = std::string(component) + " " + what + " (" + source + ")";

  reportUncaught(error, where.c_str());
}

namespace {

/// Where the main thread is in its mounts' code. Main thread only.
struct Entries {
  std::weak_ptr<Content> active;
  int depth = 0;
  std::vector<std::weak_ptr<Content>> marked;
  bool flushPosted = false;
};

Entries& entries() {
  // Never destroyed: contents may outlive static destruction.
  static auto* state = new Entries();

  return *state;
}

/// Hosts call their mounts from the main thread, in the main context or not.
bool onMainExecutor() { return ExecutionContext::main().onExecutor(); }

}  // namespace

std::shared_ptr<Content> Content::create(std::function<void()> changed) {
  return std::make_shared<Content>(Token{}, std::move(changed));
}

void Content::invalidate() {
  if (marked_ || measuring_ || !onMainExecutor()) return;

  auto& e = entries();

  marked_ = true;
  // Held weakly: a mount that goes before the flush is not measured.
  e.marked.push_back(weak_from_this());

  if (e.depth > 0 || e.flushPosted) return;

  e.flushPosted = true;
  ExecutionContext::main().post([] {
    entries().flushPosted = false;
    flush();
  });
}

size_t Content::listen(std::function<void()> listener) {
  listeners_.emplace_back(++nextListener_, std::move(listener));
  return nextListener_;
}

void Content::unlisten(size_t id) {
  std::erase_if(listeners_, [id](const auto& l) { return l.first == id; });
}

void Content::flush() {
  auto& e = entries();

  // Marks made while hosts measure wait for the next flush.
  auto marked = std::move(e.marked);

  e.marked.clear();

  for (auto& weak : marked) {
    auto content = weak.lock();

    if (!content) continue;

    content->marked_ = false;
    content->measuring_ = true;

    try {
      // A copy: a listener may listen or take one back.
      auto listeners = content->listeners_;

      for (auto& [id, listener] : listeners) listener();
      content->changed_();
    } catch (...) {
      reportUncaught(std::current_exception(), "a component's measurement");
    }

    content->measuring_ = false;
  }
}

std::weak_ptr<Content> activeContent() { return onMainExecutor() ? entries().active : std::weak_ptr<Content>(); }

ContentEntry::ContentEntry(const std::weak_ptr<Content>& content) {
  if (!onMainExecutor()) return;

  auto& e = entries();

  entered_ = true;
  outer_ = std::exchange(e.active, content);
  ++e.depth;

  if (auto entered = content.lock()) entered->invalidate();
}

ContentEntry::~ContentEntry() {
  if (!entered_) return;

  auto& e = entries();

  e.active = std::move(outer_);

  if (--e.depth == 0) Content::flush();
}

void invalidateSize(const std::weak_ptr<Content>& content) {
  if (auto target = content.lock()) target->invalidate();
}

}  // namespace lucent::ui
