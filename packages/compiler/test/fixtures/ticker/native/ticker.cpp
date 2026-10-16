// The ticker library: what a C library that keeps callbacks does with them.
#include "ticker.h"

#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

struct Ticker {
  std::vector<std::pair<void (*)(void*, double), void*>> ticks;
};

namespace {

struct Later {
  void (*done)(int32_t, void*);
  void* context;
  int32_t value;
};

std::mutex mutex;
std::vector<Later> pending;
void (*lastVisit)(void*, int32_t) = nullptr;
void* lastContext = nullptr;

}  // namespace

extern "C" {

void ticker_count(int32_t from, int32_t to, void (*visit)(void*, int32_t), void* context) {
  lastVisit = visit;
  lastContext = context;
  for (int32_t i = from; i <= to; i++) visit(context, i);
}

void ticker_recall(void) {
  if (lastVisit) lastVisit(lastContext, -1);
}

int32_t ticker_keep(const char* names, bool (*keep)(const char*, int64_t, void*), void* context) {
  std::string all(names);
  int32_t kept = 0;
  int64_t index = 0;

  for (size_t start = 0;;) {
    size_t comma = all.find(',', start);
    std::string name = all.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
    if (keep(name.c_str(), index++, context)) kept++;
    if (comma == std::string::npos) break;
    start = comma + 1;
  }

  return kept;
}

void ticker_later(int32_t value, void (*done)(int32_t, void*), void* context) {
  std::lock_guard<std::mutex> lock(mutex);
  pending.push_back({done, context, value});
}

void ticker_flush(void) {
  std::vector<Later> due;
  {
    std::lock_guard<std::mutex> lock(mutex);
    due.swap(pending);
  }

  for (const Later& l : due) {
    l.done(l.value * 2, l.context);
    l.done(l.value * 2, l.context);
  }
}

Ticker* ticker_create(void) { return new Ticker(); }

void ticker_destroy(Ticker* ticker) { delete ticker; }

void ticker_on_tick(Ticker* ticker, void (*tick)(void*, double), void* context) {
  ticker->ticks.push_back({tick, context});
}

int32_t ticker_tick(Ticker* ticker, double at) {
  for (const auto& [tick, context] : ticker->ticks) tick(context, at);
  return static_cast<int32_t>(ticker->ticks.size());
}

void ticker_count_threaded(int32_t from, int32_t to, void (*visit)(void*, int32_t), void* context) {
  std::thread([&] {
    for (int32_t i = from; i <= to; i++) visit(context, i);
  }).join();
}

int32_t ticker_check(int32_t value, bool (*ok)(void*, int32_t), void* context, TickerError* error) {
  if (ok(context, value)) return value;

  error->code = 7;
  error->message = "not ok";
  return -1;
}

}  // extern "C"
