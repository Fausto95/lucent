#include <cstdio>

#include "async.h"
#include "operation.h"
#include "bytes.h"
#include "generator.h"
#include "console.h"
#include "execution.h"
#include "report.h"
#include "scope.h"
#include "timers.h"

#include <cmath>
#include <mutex>
#include <unordered_map>

#if defined(__ANDROID__)
#include <android/log.h>
#elif defined(__APPLE__)
#include <os/log.h>
#endif

namespace lucent {

Array<String> split(const String& s, const String& separator) { return split(s, separator, 4294967295.0); }

Array<String> split(const String& s, const String& separator, double limitValue) {
  Array<String> out;
  size_t limit = toUint32(limitValue);
  if (limit == 0) return out;
  size_t n = s.length(), m = separator.length();
  if (m == 0) {
    for (size_t i = 0; i < n && out.size() < limit; i++) out.push(String::fromCodeUnit(s.unit(i)));
    return out;
  }
  size_t pos = 0;
  for (;;) {
    size_t at = s.find(separator, pos);
    if (at == std::string::npos) break;
    out.push(s.sub(pos, at));
    if (out.size() >= limit) return out;
    pos = at + m;
  }
  out.push(s.sub(pos, n));
  return out;
}

Array<String> splitCodePoints(const String& s) {
  Array<String> out;
  size_t n = s.length();
  for (size_t i = 0; i < n; i++) {
    char16_t c = s.unit(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n && s.unit(i + 1) >= 0xDC00 && s.unit(i + 1) <= 0xDFFF) {
      out.push(s.sub(i, i + 2));
      i++;
    } else {
      out.push(String::fromCodeUnit(c));
    }
  }
  return out;
}

Bytes utf8Encode(const String& s) {
  std::string u = s.toUtf8();
  return Bytes::copy(reinterpret_cast<const uint8_t*>(u.data()), u.size());
}

String utf8Decode(const Bytes& b) {
  return String::fromUtf8(std::string_view(reinterpret_cast<const char*>(b.data()), b.size()));
}

Promise<void> delay(double ms, Opt<AbortSignal> signal) {
  ContextRef owner = ExecutionContext::currentRef();

  // A timer is work like any other: under the scope the caller's work
  // belongs to, so a reload (that scope disposed) rejects it with an
  // AbortError and what awaits it unwinds instead of waiting forever.
  return nativeOperation<void>(
      [owner, ms](const std::shared_ptr<Operation<void>>& op) -> std::function<void()> {
        std::weak_ptr<Operation<void>> pending = op;

        // On the context the promise belongs to: the calling one.
        ExecutionContext::of(owner).postDelayed(ms, [pending] {
          if (auto op = pending.lock()) op->succeed();
        });

        return {};
      },
      std::move(signal));
}

Promise<void> delay(double ms) { return delay(ms, Opt<AbortSignal>()); }

namespace {

struct Timer {
  Fn<void()> fn;
  ContextRef owner;
  double ms;
  bool repeat;
  std::weak_ptr<Scope> scope;
  Scope::CleanupId cleanup = 0;
};

struct Timers {
  std::mutex m;
  std::unordered_map<uint64_t, std::shared_ptr<Timer>> live;
  uint64_t last = 0;
};

Timers& timers() {
  static Timers* t = new Timers();
  return *t;
}

/// Removes timer `id`, and its cleanup from its scope; what it held goes after the lock.
std::shared_ptr<Timer> forget(uint64_t id, bool fromScope) {
  std::shared_ptr<Timer> gone;
  {
    std::lock_guard<std::mutex> lock(timers().m);
    auto it = timers().live.find(id);
    if (it == timers().live.end()) return nullptr;
    gone = std::move(it->second);
    timers().live.erase(it);
  }
  if (!fromScope && gone->cleanup)
    if (auto scope = gone->scope.lock()) scope->remove(gone->cleanup);
  return gone;
}

void schedule(uint64_t id, const ContextRef& owner, double ms);

void fire(uint64_t id) {
  std::shared_ptr<Timer> timer;
  {
    std::lock_guard<std::mutex> lock(timers().m);
    auto it = timers().live.find(id);
    if (it == timers().live.end()) return;
    timer = it->second;
  }
  // A timeout is done once it runs: clearTimeout in its own function finds nothing.
  if (!timer->repeat) forget(id, false);
  try {
    timer->fn();
  } catch (...) {
    reportUncaught(std::current_exception(), timer->repeat ? "setInterval" : "setTimeout");
  }
  if (timer->repeat) {
    bool live;
    {
      std::lock_guard<std::mutex> lock(timers().m);
      live = timers().live.count(id) > 0;
    }
    if (live) schedule(id, timer->owner, timer->ms);
  }
}

void schedule(uint64_t id, const ContextRef& owner, double ms) {
  if (!ExecutionContext::of(owner).postDelayed(ms, [id] { fire(id); })) forget(id, false);
}

}  // namespace

double setTimer(Fn<void()> f, double ms, bool repeat) {
  if (std::isnan(ms) || ms < 0) ms = 0;
  ContextRef owner = ExecutionContext::currentRef();
  std::shared_ptr<Scope> scope = ownedScope(owner);
  auto timer = std::make_shared<Timer>(Timer{std::move(f), owner, ms, repeat, scope, 0});

  uint64_t id;
  {
    std::lock_guard<std::mutex> lock(timers().m);
    id = ++timers().last;
    timers().live.emplace(id, timer);
  }
  // Its scope's disposal (a reload) clears it.
  timer->cleanup = scope->onDispose([id] { forget(id, true); });
  if (timer->cleanup == 0) {
    forget(id, true);
    return static_cast<double>(id);
  }
  schedule(id, owner, ms);
  return static_cast<double>(id);
}

void clearTimer(const Opt<double>& id) {
  if (!id.has()) return;
  double v = id.get();
  if (!(v >= 1) || v != std::trunc(v) || v > 9007199254740991.0) return;
  forget(static_cast<uint64_t>(v), false);
}

void queueMicrotask(Fn<void()> f) {
  ExecutionContext* context = ExecutionContext::current();
  auto run = [f = std::move(f)] {
    try {
      f();
    } catch (...) {
      reportUncaught(std::current_exception(), "queueMicrotask");
    }
  };
  if (context) context->enqueueMicrotask(std::move(run));
  else ExecutionContext::of(nullptr).post(std::move(run));
}

size_t pendingTimers() {
  std::lock_guard<std::mutex> lock(timers().m);
  return timers().live.size();
}

namespace {
ConsoleSink& sink() {
  static ConsoleSink s;
  return s;
}
}  // namespace

void setConsoleSink(ConsoleSink s) { sink() = std::move(s); }

void consoleWrite(ConsoleLevel level, const String& message) {
  if (sink()) {
    sink()(level, message);
    return;
  }
  std::string text = message.toUtf8();
#if defined(__ANDROID__)
  int prio = level == ConsoleLevel::Error ? ANDROID_LOG_ERROR : level == ConsoleLevel::Warn ? ANDROID_LOG_WARN : ANDROID_LOG_INFO;
  __android_log_print(prio, "Lucent", "%s", text.c_str());
#elif defined(__APPLE__)
  os_log_type_t type = level == ConsoleLevel::Error ? OS_LOG_TYPE_ERROR : OS_LOG_TYPE_DEFAULT;
  os_log_with_type(OS_LOG_DEFAULT, type, "[Lucent] %{public}s", text.c_str());
#else
  std::fprintf(level == ConsoleLevel::Log ? stdout : stderr, "%s\n", text.c_str());
  std::fflush(level == ConsoleLevel::Log ? stdout : stderr);
#endif
}

}  // namespace lucent

#include "json.h"

namespace lucent {

void JsonWriter::quote(const String& s) {
  static const char* hex = "0123456789abcdef";
  out.push_back(u'"');
  size_t n = s.length();
  for (size_t i = 0; i < n; i++) {
    char16_t c = s.unit(i);
    switch (c) {
      case u'"': out.append(u"\\\""); break;
      case u'\\': out.append(u"\\\\"); break;
      case u'\b': out.append(u"\\b"); break;
      case u'\f': out.append(u"\\f"); break;
      case u'\n': out.append(u"\\n"); break;
      case u'\r': out.append(u"\\r"); break;
      case u'\t': out.append(u"\\t"); break;
      default: {
        bool lone = false;
        if (c >= 0xD800 && c <= 0xDBFF) {
          lone = !(i + 1 < n && s.unit(i + 1) >= 0xDC00 && s.unit(i + 1) <= 0xDFFF);
          if (!lone) {
            out.push_back(c);
            out.push_back(s.unit(++i));
            continue;
          }
        } else if (c >= 0xDC00 && c <= 0xDFFF) {
          lone = true;
        }
        if (c < 0x20 || lone) {
          out.append(u"\\u");
          out.push_back(hex[(c >> 12) & 15]);
          out.push_back(hex[(c >> 8) & 15]);
          out.push_back(hex[(c >> 4) & 15]);
          out.push_back(hex[c & 15]);
        } else {
          out.push_back(c);
        }
      }
    }
  }
  out.push_back(u'"');
}

Iter<String> iterOf(const String& s) { return iterOf(splitCodePoints(s)); }


}  // namespace lucent
