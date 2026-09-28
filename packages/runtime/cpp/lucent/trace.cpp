#include "trace.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <mutex>
#include <string>

#include "execution.h"

#if defined(__APPLE__)
#include <os/log.h>
#include <os/signpost.h>
#elif defined(__ANDROID__)
#include <android/trace.h>
#include <dlfcn.h>
#include <sys/system_properties.h>
#endif

namespace lucent::trace {

namespace {

// --- the buffer -------------------------------------------------------------------

/// The latest `capacity` events, as a ring.
struct Buffer {
  std::mutex m;
  std::vector<Event> ring;
  size_t head = 0;
  size_t size = 0;
  uint64_t dropped = 0;

  void push(const Event& e) {
    std::lock_guard<std::mutex> g(m);

    if (ring.empty()) return;

    if (size < ring.size()) {
      ring[(head + size) % ring.size()] = e;
      size++;
      return;
    }

    ring[head] = e;
    head = (head + 1) % ring.size();
    dropped++;
  }
};

Buffer& buffer() {
  // Leaked: threads may still record during static destruction.
  static auto* b = new Buffer();
  return *b;
}

std::atomic<bool> platformOn{false};
std::atomic<uint64_t> nextId{1};
std::atomic<uint32_t> nextThread{1};

thread_local uint32_t threadNumber = 0;
thread_local uint64_t runningId = 0;
thread_local uint64_t pendingCorrelation = 0;

uint32_t thisThread() {
  if (!threadNumber) threadNumber = nextThread.fetch_add(1, std::memory_order_relaxed);
  return threadNumber;
}

uint32_t thisContext() {
  ExecutionContext* context = ExecutionContext::current();
  return context ? context->id() : 0;
}

void record(Event e) {
  e.thread = thisThread();
  e.context = thisContext();
  buffer().push(e);
}

// --- the platform's tooling ---------------------------------------------------------

#if defined(__APPLE__)

os_log_t signposts() {
  static os_log_t log = os_log_create("dev.lucent", "runtime");
  return log;
}

// os_signpost names must be literals: one per category.
#define LUCENT_SIGNPOST(kind, id, category, name)                                               \
  switch (category) {                                                                           \
    case Category::Entry: os_signpost_interval_##kind(signposts(), id, "entry", "%{public}s", name); break; \
    case Category::Lock: os_signpost_interval_##kind(signposts(), id, "lock", "%{public}s", name); break; \
    case Category::Queue: os_signpost_interval_##kind(signposts(), id, "queue", "%{public}s", name); break; \
    case Category::Run: os_signpost_interval_##kind(signposts(), id, "run", "%{public}s", name); break; \
    case Category::Native: os_signpost_interval_##kind(signposts(), id, "native", "%{public}s", name); break; \
    case Category::Completion: os_signpost_interval_##kind(signposts(), id, "completion", "%{public}s", name); break; \
    case Category::Compute: os_signpost_interval_##kind(signposts(), id, "compute", "%{public}s", name); break; \
    case Category::Copy: os_signpost_interval_##kind(signposts(), id, "copy", "%{public}s", name); break; \
    case Category::Alloc: os_signpost_interval_##kind(signposts(), id, "alloc", "%{public}s", name); break; \
    case Category::Build: os_signpost_interval_##kind(signposts(), id, "build", "%{public}s", name); break; \
  }

void platformBegin(uint64_t cookie, Category category, const char* name) {
  os_signpost_id_t id = static_cast<os_signpost_id_t>(cookie);
  LUCENT_SIGNPOST(begin, id, category, name)
}

void platformEnd(uint64_t cookie, Category category, const char* name) {
  os_signpost_id_t id = static_cast<os_signpost_id_t>(cookie);
  LUCENT_SIGNPOST(end, id, category, name)
}

void platformInstant(Category category, const char* name, int64_t value) {
  os_signpost_event_emit(signposts(), OS_SIGNPOST_ID_EXCLUSIVE, "event", "%{public}s %{public}s %lld", categoryName(category), name,
                         static_cast<long long>(value));
}

void platformCounter(const char* name, int64_t value) {
  os_signpost_event_emit(signposts(), OS_SIGNPOST_ID_EXCLUSIVE, "counter", "%{public}s %lld", name, static_cast<long long>(value));
}

#undef LUCENT_SIGNPOST

#elif defined(__ANDROID__)

// Async sections and counters came with API 29; looked up, so older
// devices still load the library (they get synchronous sections only).
using AsyncSection = void (*)(const char*, int32_t);
using Counter = void (*)(const char*, int64_t);

struct Atrace {
  AsyncSection beginAsync = nullptr;
  AsyncSection endAsync = nullptr;
  Counter setCounter = nullptr;

  Atrace() {
    void* android = dlopen("libandroid.so", RTLD_NOW | RTLD_NOLOAD);
    if (!android) return;

    beginAsync = reinterpret_cast<AsyncSection>(dlsym(android, "ATrace_beginAsyncSection"));
    endAsync = reinterpret_cast<AsyncSection>(dlsym(android, "ATrace_endAsyncSection"));
    setCounter = reinterpret_cast<Counter>(dlsym(android, "ATrace_setCounter"));
  }
};

const Atrace& atrace() {
  static Atrace a;
  return a;
}

std::string sectionName(Category category, const char* name) { return std::string(categoryName(category)) + ":" + name; }

void platformBegin(uint64_t cookie, Category category, const char* name) {
  if (!ATrace_isEnabled() || !atrace().beginAsync) return;

  atrace().beginAsync(sectionName(category, name).c_str(), static_cast<int32_t>(cookie & 0x7fffffff));
}

void platformEnd(uint64_t cookie, Category category, const char* name) {
  if (!ATrace_isEnabled() || !atrace().endAsync) return;

  atrace().endAsync(sectionName(category, name).c_str(), static_cast<int32_t>(cookie & 0x7fffffff));
}

void platformInstant(Category category, const char* name, int64_t) {
  if (!ATrace_isEnabled()) return;

  ATrace_beginSection(sectionName(category, name).c_str());
  ATrace_endSection();
}

void platformCounter(const char* name, int64_t value) {
  if (!ATrace_isEnabled() || !atrace().setCounter) return;

  atrace().setCounter(name, value);
}

#else

void platformBegin(uint64_t, Category, const char*) {}
void platformEnd(uint64_t, Category, const char*) {}
void platformInstant(Category, const char*, int64_t) {}
void platformCounter(const char*, int64_t) {}

#endif

// --- JSON -----------------------------------------------------------------------------

void appendString(std::string& out, const char* s) {
  out.push_back('"');

  for (const char* p = s ? s : ""; *p; p++) {
    unsigned char c = static_cast<unsigned char>(*p);

    if (c == '"' || c == '\\') {
      out.push_back('\\');
      out.push_back(static_cast<char>(c));
    } else if (c < 0x20) {
      char escaped[8];
      std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
      out += escaped;
    } else {
      out.push_back(static_cast<char>(c));
    }
  }

  out.push_back('"');
}

void appendMicros(std::string& out, uint64_t ns) {
  char text[32];
  std::snprintf(text, sizeof text, "%llu.%03llu", static_cast<unsigned long long>(ns / 1000), static_cast<unsigned long long>(ns % 1000));
  out += text;
}

void appendNumber(std::string& out, long long v) { out += std::to_string(v); }

// --- the environment -------------------------------------------------------------------

std::string environmentSetting() {
#if defined(__ANDROID__)
  char value[PROP_VALUE_MAX] = {};
  if (__system_property_get("debug.lucent.trace", value) > 0) return value;
  return "";
#else
  const char* value = std::getenv("LUCENT_TRACE");
  return value ? value : "";
#endif
}

std::string& exitPath() {
  static auto* path = new std::string();
  return *path;
}

}  // namespace

const char* categoryName(Category category) {
  switch (category) {
    case Category::Entry: return "entry";
    case Category::Lock: return "lock";
    case Category::Queue: return "queue";
    case Category::Run: return "run";
    case Category::Native: return "native";
    case Category::Completion: return "completion";
    case Category::Compute: return "compute";
    case Category::Copy: return "copy";
    case Category::Alloc: return "alloc";
    case Category::Build: return "build";
  }

  return "native";
}

void start(Options options) {
  Buffer& b = buffer();

  {
    std::lock_guard<std::mutex> g(b.m);

    b.ring.assign(std::max<size_t>(options.capacity, 1), Event{});
    b.head = 0;
    b.size = 0;
    b.dropped = 0;
  }

  platformOn.store(options.platform, std::memory_order_relaxed);
  detail::active.store(true, std::memory_order_release);
}

void stop() { detail::active.store(false, std::memory_order_release); }

void startFromEnvironment() {
  static std::once_flag once;

  std::call_once(once, [] {
    std::string setting = environmentSetting();
    if (setting.empty() || setting == "0") return;

#if defined(__ANDROID__)
    // ATrace costs a check while nothing records: always mirrored.
    bool platform = true;
#else
    bool platform = setting == "platform";
#endif

    start({.platform = platform});

    // A file to write the trace to at exit.
    if (setting.size() > 5 && setting.compare(setting.size() - 5, 5, ".json") == 0) {
      exitPath() = setting;
      std::atexit([] { writeChromeJson(exitPath()); });
    }
  });
}

std::vector<Event> events() {
  Buffer& b = buffer();
  std::lock_guard<std::mutex> g(b.m);

  std::vector<Event> out;
  out.reserve(b.size);

  for (size_t i = 0; i < b.size; i++) out.push_back(b.ring[(b.head + i) % b.ring.size()]);

  return out;
}

uint64_t dropped() {
  Buffer& b = buffer();
  std::lock_guard<std::mutex> g(b.m);
  return b.dropped;
}

uint64_t toNs(std::chrono::steady_clock::time_point at) noexcept {
  // Never 0: a Mark's start of 0 means "not traced".
  auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(at.time_since_epoch()).count();
  return static_cast<uint64_t>(ns) | 1;
}

uint64_t now() noexcept { return toNs(std::chrono::steady_clock::now()); }

uint64_t newId() noexcept { return nextId.fetch_add(1, std::memory_order_relaxed); }

Mark begin(Category category, const char* name) noexcept {
  if (!enabled()) return {};

  Mark mark{now(), 0};

  if (platformOn.load(std::memory_order_relaxed)) {
    mark.cookie = newId();
    platformBegin(mark.cookie, category, name);
  }

  return mark;
}

void end(const Mark& mark, Category category, const char* name, const Detail& detail) noexcept {
  if (!mark) return;

  if (mark.cookie) platformEnd(mark.cookie, category, name);

  if (!enabled()) return;

  span(category, name, mark.startNs, now(), detail);
}

void span(Category category, const char* name, uint64_t startNs, uint64_t endNs, const Detail& detail) noexcept {
  if (!enabled()) return;

  Event e;
  e.phase = Event::Phase::Span;
  e.category = category;
  e.name = name;
  e.detail = detail.detail;
  e.startNs = startNs;
  e.durationNs = endNs > startNs ? endNs - startNs : 0;
  e.id = detail.id;
  e.parent = detail.parent;
  e.value = detail.value;
  e.count = detail.count;
  e.site = detail.site;
  record(e);
}

void instant(Category category, const char* name, uint64_t id, int64_t value) noexcept {
  instant(category, name, {.id = id, .value = value});
}

void instant(Category category, const char* name, const Detail& detail) noexcept {
  if (!enabled()) return;

  Event e;
  e.phase = Event::Phase::Instant;
  e.category = category;
  e.name = name;
  e.detail = detail.detail;
  e.startNs = now();
  e.id = detail.id;
  e.parent = detail.parent;
  e.value = detail.value;
  e.count = detail.count;
  e.site = detail.site;
  record(e);

  if (platformOn.load(std::memory_order_relaxed)) platformInstant(category, name, detail.value);
}

void counter(const char* name, int64_t value) noexcept {
  if (!enabled()) return;

  Event e;
  e.phase = Event::Phase::Counter;
  e.name = name;
  e.startNs = now();
  e.value = value;
  record(e);

  if (platformOn.load(std::memory_order_relaxed)) platformCounter(name, value);
}

uint64_t currentId() noexcept { return runningId; }

Current::Current(uint64_t id) noexcept : previous_(runningId) { runningId = id; }

Current::~Current() { runningId = previous_; }

Correlate::Correlate(uint64_t id) noexcept : previous_(pendingCorrelation) { pendingCorrelation = id; }

Correlate::~Correlate() { pendingCorrelation = previous_; }

uint64_t takeCorrelation() noexcept { return std::exchange(pendingCorrelation, 0); }

// --- export ---------------------------------------------------------------------------

std::string chromeJson(const std::vector<Event>& events) {
  std::string out = "{\"traceEvents\":[";
  bool first = true;

  auto open = [&] {
    if (!first) out += ",\n";
    first = false;
  };

  // Every event, with what it says in args.
  for (const Event& e : events) {
    open();

    out += "{\"name\":";
    appendString(out, e.name);
    out += ",\"cat\":";
    appendString(out, e.phase == Event::Phase::Counter ? "counter" : categoryName(e.category));
    out += ",\"ph\":\"";
    out.push_back(static_cast<char>(e.phase));
    out += "\",\"ts\":";
    appendMicros(out, e.startNs);

    if (e.phase == Event::Phase::Span) {
      out += ",\"dur\":";
      appendMicros(out, e.durationNs);
    }

    if (e.phase == Event::Phase::Instant) out += ",\"s\":\"t\"";

    out += ",\"pid\":1,\"tid\":";
    appendNumber(out, e.thread);
    out += ",\"args\":{";

    if (e.phase == Event::Phase::Counter) {
      appendString(out, e.name);
      out += ":";
      appendNumber(out, e.value);
    } else {
      out += "\"context\":";
      appendNumber(out, e.context);

      if (e.id) {
        out += ",\"id\":";
        appendNumber(out, static_cast<long long>(e.id));
      }

      if (e.parent) {
        out += ",\"parent\":";
        appendNumber(out, static_cast<long long>(e.parent));
      }

      if (e.value) {
        out += ",\"value\":";
        appendNumber(out, e.value);
      }

      if (e.count) {
        out += ",\"count\":";
        appendNumber(out, e.count);
      }

      if (e.detail) {
        out += ",\"detail\":";
        appendString(out, e.detail);
      }

      if (e.site) {
        std::string where = std::string(e.site->file ? e.site->file : "") + ":" + std::to_string(e.site->line);
        out += ",\"site\":";
        appendString(out, where.c_str());
      }
    }

    out += "}}";
  }

  // Arrows between events that share an id, in time order: a JS call to
  // its job's wait, run and completion.
  std::map<uint64_t, std::vector<const Event*>> flows;
  for (const Event& e : events) {
    if (e.id && e.phase == Event::Phase::Span) flows[e.id].push_back(&e);
  }

  for (auto& [id, chain] : flows) {
    if (chain.size() < 2) continue;

    std::stable_sort(chain.begin(), chain.end(), [](const Event* a, const Event* b) { return a->startNs < b->startNs; });

    for (size_t i = 0; i + 1 < chain.size(); i++) {
      for (int side = 0; side < 2; side++) {
        const Event* e = chain[i + side];

        open();
        out += side == 0 ? "{\"ph\":\"s\"" : "{\"ph\":\"f\",\"bp\":\"e\"";
        out += ",\"name\":\"correlation\",\"cat\":\"flow\",\"id\":";
        appendNumber(out, static_cast<long long>(id));
        out += ",\"ts\":";
        appendMicros(out, e->startNs);
        out += ",\"pid\":1,\"tid\":";
        appendNumber(out, e->thread);
        out += "}";
      }
    }
  }

  out += "],\"displayTimeUnit\":\"ms\",\"otherData\":{\"dropped\":";
  appendNumber(out, static_cast<long long>(dropped()));
  out += "}}\n";
  return out;
}

bool writeChromeJson(const std::string& path) {
  std::ofstream file(path);
  if (!file) return false;

  file << chromeJson(events());
  return static_cast<bool>(file);
}

}  // namespace lucent::trace
