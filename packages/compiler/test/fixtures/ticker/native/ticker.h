/*
 * A C library that calls back (decisions 0126 and 0128): during the call,
 * once later, as long as a handle lives, and from another thread.
 */
#ifndef TICKER_H
#define TICKER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct Ticker Ticker;

typedef struct {
  int code;
  const char* message;
} TickerError;

/* Calls visit with each integer from `from` to `to`, during the call: its context first. */
void ticker_count(int32_t from, int32_t to, void (*visit)(void* context, int32_t value), void* context);

/* Calls the last ticker_count's visit again, after it returned: a call that does nothing. */
void ticker_recall(void);

/* How many of the comma-separated names keep keeps: a result, its context last. */
int32_t ticker_keep(const char* names, bool (*keep)(const char* name, int64_t index, void* context),
                    void* context);

/* Calls done with twice the value on the next ticker_flush, and again after: once is all it lives for. */
void ticker_later(int32_t value, void (*done)(int32_t doubled, void* context), void* context);
void ticker_flush(void);

/* A ticker calls each tick it was given on each ticker_tick, as long as it lives. */
Ticker* ticker_create(void);
void ticker_destroy(Ticker* ticker);
void ticker_on_tick(Ticker* ticker, void (*tick)(void* context, double at), void* context);
/* How many ticks it called. */
int32_t ticker_tick(Ticker* ticker, double at);

/* As ticker_count, from a thread it joins before it returns. */
void ticker_count_threaded(int32_t from, int32_t to, void (*visit)(void* context, int32_t value),
                           void* context);

/* Takes up to `most` steps, calling step after each, until stop turns true: how many it took. */
int32_t ticker_steps(int32_t most, void (*step)(void* context, int32_t n), void* context,
                     const volatile bool* stop);

/* The value, if ok says it is; else -1, with the error. */
int32_t ticker_check(int32_t value, bool (*ok)(void* context, int32_t value), void* context,
                     TickerError* error);

#ifdef __cplusplus
}
#endif

#endif
