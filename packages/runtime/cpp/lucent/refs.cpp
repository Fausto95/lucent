#include "refs.h"

#include <algorithm>
#include <atomic>
#include <functional>
#include <mutex>
#include <set>
#include <unordered_map>
#include <utility>

namespace lucent::debug {

namespace detail {

std::atomic<bool> tracking{false};

namespace {

/// The objects listed, each with the order it was made in.
struct Registry {
  std::mutex m;
  std::unordered_map<const Object*, uint64_t> objects;
  uint64_t next = 0;
  /// The cycles already reported, by their objects' order numbers.
  std::set<std::vector<uint64_t>> reported;
};

Registry& registry() {
  // Never destroyed: objects that outlive static destruction still untrack.
  static auto* r = new Registry();
  return *r;
}

}  // namespace

void track(const Object* o) noexcept {
  Registry& r = registry();
  std::lock_guard<std::mutex> g(r.m);
  r.objects.insert_or_assign(o, r.next++);
}

void untrack(const Object* o) noexcept {
  Registry& r = registry();
  std::lock_guard<std::mutex> g(r.m);
  r.objects.erase(o);
}

}  // namespace detail

void trackObjects() { detail::tracking.store(true, std::memory_order_relaxed); }

bool tracksObjects() { return detail::tracking.load(std::memory_order_relaxed); }

namespace {

struct Edge {
  size_t to;
  CycleStep step;
};

/// Collects one object's references among the objects of the walk.
class Collect final : public RefSink {
 public:
  Collect(const std::unordered_map<const Object*, size_t>& index, std::vector<Edge>& out) : index_(index), out_(out) {}

  void edge(const Object* to, const char* name, const char* where, const char* closure, const char* capture) override {
    auto it = index_.find(to);
    const auto text = [](const char* s) { return std::string(s ? s : ""); };
    if (it != index_.end()) out_.push_back({it->second, {text(name), text(where), text(closure), text(capture)}});
  }

 private:
  const std::unordered_map<const Object*, size_t>& index_;
  std::vector<Edge>& out_;
};

/// Tarjan's strongly connected components, iteratively: each component's
/// nodes, for the components with more than one node or a node that
/// refers to itself.
std::vector<std::vector<size_t>> knots(const std::vector<std::vector<Edge>>& graph) {
  const size_t n = graph.size();
  const size_t unvisited = SIZE_MAX;
  std::vector<size_t> index(n, unvisited), low(n, 0);
  std::vector<bool> onStack(n, false);
  std::vector<size_t> stack;
  std::vector<std::vector<size_t>> out;
  size_t counter = 0;

  struct Frame {
    size_t node;
    size_t next;
  };

  for (size_t root = 0; root < n; root++) {
    if (index[root] != unvisited) continue;

    std::vector<Frame> frames{{root, 0}};
    index[root] = low[root] = counter++;
    stack.push_back(root);
    onStack[root] = true;

    while (!frames.empty()) {
      Frame& f = frames.back();
      const size_t v = f.node;

      if (f.next < graph[v].size()) {
        const size_t w = graph[v][f.next++].to;
        if (index[w] == unvisited) {
          index[w] = low[w] = counter++;
          stack.push_back(w);
          onStack[w] = true;
          frames.push_back({w, 0});
        } else if (onStack[w]) {
          low[v] = std::min(low[v], index[w]);
        }
        continue;
      }

      if (low[v] == index[v]) {
        std::vector<size_t> component;
        size_t w;
        do {
          w = stack.back();
          stack.pop_back();
          onStack[w] = false;
          component.push_back(w);
        } while (w != v);

        const bool selfRef = std::any_of(graph[v].begin(), graph[v].end(), [&](const Edge& e) { return e.to == v; });
        if (component.size() > 1 || selfRef) out.push_back(std::move(component));
      }

      frames.pop_back();
      if (!frames.empty()) {
        const size_t parent = frames.back().node;
        low[parent] = std::min(low[parent], low[v]);
      }
    }
  }

  return out;
}

/// The shortest path of edges from `from` back to it, within `members`.
std::vector<Edge> loopFrom(size_t from, const std::vector<std::vector<Edge>>& graph, const std::set<size_t>& members) {
  // Breadth first from `from`'s successors, remembering how each was reached.
  std::unordered_map<size_t, std::pair<size_t, Edge>> cameFrom;
  std::vector<size_t> frontier{from};
  bool closed = false;
  Edge last{};
  size_t lastFrom = from;

  for (size_t i = 0; i < frontier.size() && !closed; i++) {
    const size_t v = frontier[i];
    for (const Edge& e : graph[v]) {
      if (!members.count(e.to)) continue;
      if (e.to == from) {
        closed = true;
        last = e;
        lastFrom = v;
        break;
      }
      if (cameFrom.count(e.to)) continue;
      cameFrom.emplace(e.to, std::make_pair(v, e));
      frontier.push_back(e.to);
    }
  }

  std::vector<Edge> path{last};
  for (size_t v = lastFrom; v != from;) {
    const auto& [prev, e] = cameFrom.at(v);
    path.push_back(e);
    v = prev;
  }
  std::reverse(path.begin(), path.end());
  return path;
}

}  // namespace

std::vector<Cycle> cycles(bool fresh) {
  // The objects alive now, kept alive for the walk: one whose destruction
  // has begun gives no strong reference.
  std::vector<std::pair<std::shared_ptr<const Object>, uint64_t>> alive;
  detail::Registry& r = detail::registry();
  {
    std::lock_guard<std::mutex> g(r.m);
    alive.reserve(r.objects.size());
    for (const auto& [o, order] : r.objects)
      if (auto strong = o->weak_from_this().lock()) alive.emplace_back(std::move(strong), order);
  }

  // Oldest first: a cycle is told from the object made first.
  std::sort(alive.begin(), alive.end(), [](const auto& a, const auto& b) { return a.second < b.second; });

  std::unordered_map<const Object*, size_t> index;
  for (size_t i = 0; i < alive.size(); i++) index.emplace(alive[i].first.get(), i);

  std::vector<std::vector<Edge>> graph(alive.size());
  for (size_t i = 0; i < alive.size(); i++) {
    Collect collect(index, graph[i]);
    alive[i].first->lucentRefs_(collect);
  }

  std::vector<Cycle> out;
  for (auto& component : knots(graph)) {
    std::sort(component.begin(), component.end());

    std::vector<uint64_t> key;
    for (size_t v : component) key.push_back(alive[v].second);
    {
      std::lock_guard<std::mutex> g(r.m);
      const bool known = !r.reported.insert(key).second;
      if (fresh && known) continue;
    }

    const std::set<size_t> members(component.begin(), component.end());
    Cycle cycle;
    cycle.objects = component.size();
    for (const Edge& e : loopFrom(component.front(), graph, members)) cycle.steps.push_back(e.step);
    out.push_back(std::move(cycle));
  }

  // The walk's references go here, outside the registry's lock: a last one
  // destroys its object, which untracks itself.
  alive.clear();
  return out;
}

std::string describe(const Cycle& cycle) {
  std::string out = "a reference cycle keeps " + std::to_string(cycle.objects) + (cycle.objects == 1 ? " object" : " objects") +
                    " alive: ";
  for (size_t i = 0; i < cycle.steps.size(); i++) {
    const CycleStep& s = cycle.steps[i];
    if (i > 0) out += ", then ";
    out += s.field.empty() ? "a reference" : s.field;
    if (!s.where.empty()) out += " (" + s.where + ")";
    if (!s.closure.empty()) out += ", then the closure at " + s.closure + ", which captures " + s.capture;
  }
  out += cycle.steps.size() == 1 ? ", to itself." : ", back to the first.";
  if (cycle.steps.empty()) return out;

  // The reference back to what came first: through the closure that captures it, or its field.
  const CycleStep& back = cycle.steps.back();
  if (!back.closure.empty())
    out += " Capture a WeakRef of " + back.capture + " in the closure at " + back.closure + " to break it.";
  else if (!back.field.empty())
    out += " Hold " + back.field + " through a WeakRef to break it.";
  return out;
}

}  // namespace lucent::debug
