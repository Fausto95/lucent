// Lucent runtime — tracing.
//
// Structured events that say why something was slow: how long a job waited
// for its owner before it ran, how long a call waited for the Lucent lock,
// how long a compute task waited for a worker, ran and waited to be
// delivered, how many bytes a copy moved. Events that belong together (a
// JS call, the job it posted, its completion) share a correlation id; a
// job posted from another names it as its parent. Native code records its
// own spans with the .lucent.ts site its #line names (LUCENT_TRACE_SCOPE).
//
// Tracing is off by default and costs one relaxed load where it is
// checked. Started, it keeps the latest events in a bounded buffer
// (counting those it drops), exportable as a Chrome trace; asked to, it
// also mirrors spans live into the platform's tooling: os_signpost on
// Apple platforms (Instruments), ATrace on Android (Perfetto, systrace).
// The mirror is opt-in: signposts persist even when no tool records them.
//
// It starts from the environment too, when the module context starts:
// LUCENT_TRACE=1 (the buffer), =platform (and the platform's tooling), or
// =<file>.json (and a Chrome trace written there at exit). On Android the
// debug.lucent.trace system property says the same, and ATrace, cheap
// while nothing records, is always mirrored.
#pragma once

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace lucent::trace {

enum class Category : uint8_t {
  /// A call from JavaScript into Lucent code.
  Entry,
  /// Waiting for the Lucent lock.
  Lock,
  /// A posted job waiting for its owner to run it.
  Queue,
  /// A posted job running on its owner.
  Run,
  /// Native work: Lucent code, platform calls.
  Native,
  /// A result delivered back to JavaScript.
  Completion,
  /// A compute task: waiting for a worker, running, being delivered.
  Compute,
  /// Bytes copied (transport, native buffer snapshots).
  Copy,
  /// Native allocations.
  Alloc,
  /// A build phase (the CLI's build record).
  Build,
};

const char* categoryName(Category category);

/// Where native code came from: static, like the events that point at it.
struct Site {
  const char* name;
  const char* file;
  int line;
};

struct Event {
  enum class Phase : char { Span = 'X', Instant = 'i', Counter = 'C' };

  Phase phase = Phase::Span;
  Category category = Category::Native;
  /// A static string, like every string an event holds.
  const char* name = "";
  /// What the event concerns: a compute task's entry, say.
  const char* detail = nullptr;

  /// Nanoseconds on the trace clock (steady), and the span's length.
  uint64_t startNs = 0;
  uint64_t durationNs = 0;

  /// What it is correlated with, and what it came from (0: nothing).
  uint64_t id = 0;
  uint64_t parent = 0;

  /// Bytes copied, a queue's depth, a counter's value; objects copied.
  int64_t value = 0;
  int64_t count = 0;

  /// A small number per thread, and the execution context it was in (0:
  /// none).
  uint32_t thread = 0;
  uint32_t context = 0;

  const Site* site = nullptr;
};

struct Options {
  /// Events kept: the latest, older ones are dropped and counted.
  size_t capacity = 1 << 16;
  /// Mirror spans into os_signpost / ATrace as well.
  bool platform = false;
};

namespace detail {
// Constant-initialized: safe to read during static initialization.
inline std::atomic<bool> active{false};
}  // namespace detail

/// Whether tracing is on: one relaxed load.
inline bool enabled() noexcept { return detail::active.load(std::memory_order_relaxed); }

/// Starts tracing with an empty buffer.
void start(Options options = {});

/// Stops recording; the buffer stays readable.
void stop();

/// Starts tracing if the environment asks for it (LUCENT_TRACE, or the
/// debug.lucent.trace property on Android). Once per process.
void startFromEnvironment();

/// The events kept, oldest first, and how many were dropped.
std::vector<Event> events();
uint64_t dropped();

/// The Chrome trace event format (chrome://tracing, Perfetto's UI), with
/// flow arrows between events that share an id.
std::string chromeJson(const std::vector<Event>& events);

/// Writes events() as a Chrome trace; false if the file cannot be written.
bool writeChromeJson(const std::string& path);

/// Nanoseconds on the trace clock.
uint64_t now() noexcept;
uint64_t toNs(std::chrono::steady_clock::time_point at) noexcept;

/// A process-unique correlation id (never 0).
uint64_t newId() noexcept;

/// What an event adds to its category and name.
struct Detail {
  uint64_t id = 0;
  uint64_t parent = 0;
  int64_t value = 0;
  int64_t count = 0;
  const Site* site = nullptr;
  const char* detail = nullptr;
};

/// The start of a span; empty when tracing was off.
struct Mark {
  uint64_t startNs = 0;
  /// Pairs the platform's begin and end, across threads.
  uint64_t cookie = 0;

  explicit operator bool() const noexcept { return startNs != 0; }
};

/// Begins a span: now, and live in the platform's tooling. Empty when off.
Mark begin(Category category, const char* name) noexcept;

/// Ends the span `mark` began (nothing if it is empty, or tracing stopped).
void end(const Mark& mark, Category category, const char* name, const Detail& detail = {}) noexcept;

/// A span recorded after the fact, from its two times.
void span(Category category, const char* name, uint64_t startNs, uint64_t endNs, const Detail& detail = {}) noexcept;

void instant(Category category, const char* name, uint64_t id = 0, int64_t value = 0) noexcept;
void instant(Category category, const char* name, const Detail& detail) noexcept;

void counter(const char* name, int64_t value) noexcept;

/// The correlation id of the traced job running on this thread (0: none).
uint64_t currentId() noexcept;

/// While it lives, the traced job on this thread is `id`: jobs it posts
/// name it as their parent.
class Current {
 public:
  explicit Current(uint64_t id) noexcept;
  ~Current();

  Current(const Current&) = delete;
  Current& operator=(const Current&) = delete;

 private:
  uint64_t previous_;
};

/// While it lives, the next job posted from this thread takes `id` rather
/// than a new one: a JS call's id carried to the job it posts.
class Correlate {
 public:
  explicit Correlate(uint64_t id) noexcept;
  ~Correlate();

  Correlate(const Correlate&) = delete;
  Correlate& operator=(const Correlate&) = delete;

 private:
  uint64_t previous_;
};

/// The id a Correlate set for this thread's next post, taken (0: none).
uint64_t takeCorrelation() noexcept;

/// A span over a scope (native work): LUCENT_TRACE_SCOPE.
class Scope {
 public:
  Scope(Category category, const char* name, const Site* site = nullptr, uint64_t id = 0) noexcept
      : category_(category), name_(name), site_(site), id_(id) {
    if (enabled()) [[unlikely]]
      mark_ = begin(category, name);
  }

  ~Scope() {
    if (mark_) [[unlikely]]
      end(mark_, category_, name_, {.id = id_, .parent = currentId(), .value = value_, .site = site_});
  }

  Scope(const Scope&) = delete;
  Scope& operator=(const Scope&) = delete;

  void value(int64_t v) noexcept { value_ = v; }

 private:
  Mark mark_;
  Category category_;
  const char* name_;
  const Site* site_;
  uint64_t id_;
  int64_t value_ = 0;
};

}  // namespace lucent::trace

#define LUCENT_TRACE_CONCAT_(a, b) a##b
#define LUCENT_TRACE_CONCAT(a, b) LUCENT_TRACE_CONCAT_(a, b)

/// A static site: `name` at the file and line the code names (under a
/// #line, the .lucent.ts source), or at `file`:`line` given explicitly.
#define LUCENT_TRACE_SITE(name) LUCENT_TRACE_SITE_AT(name, __FILE__, __LINE__)
#define LUCENT_TRACE_SITE_AT(name, file, line)                                                    \
  ([]() -> const ::lucent::trace::Site* {                                                         \
    static constexpr ::lucent::trace::Site lucentTraceSite{name, file, line};                    \
    return &lucentTraceSite;                                                                      \
  }())

/// A native span over the rest of the scope, named `name`, at its site.
#define LUCENT_TRACE_SCOPE(name)                                                                  \
  ::lucent::trace::Scope LUCENT_TRACE_CONCAT(lucentTraceScope, __LINE__)(::lucent::trace::Category::Native, name, \
                                                                          LUCENT_TRACE_SITE(name))
