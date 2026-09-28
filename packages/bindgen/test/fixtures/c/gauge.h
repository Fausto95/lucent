#ifndef GAUGE_H
#define GAUGE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "gauge_types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct Gauge Gauge;

typedef struct {
  int code;
  const char* message;
} GaugeError;

struct GaugeRange {
  double low;
  double high;
};

Gauge* gauge_create(double scale, GaugeError* error);
void gauge_destroy(Gauge* gauge);
int gauge_read(Gauge* gauge, const uint8_t* input, size_t input_length, uint8_t* output,
               size_t output_length, GaugeError* error);
uint64_t gauge_total(const Gauge* gauge);
gauge_count gauge_samples(const Gauge* _Nonnull gauge);
bool gauge_ready(void);
GaugeMode gauge_mode(Gauge* gauge);
struct GaugeRange gauge_range(Gauge* gauge);
void gauge_each(Gauge* gauge, void (*visit)(double value, void* context), void* context);
int gauge_sum(int count, ...);
long long gauge_offset(signed char a, unsigned short b, unsigned int c, unsigned long d);

/* A pointer typedef names the pointer, not the struct. */
typedef struct Gauge* GaugeRef;
GaugeRef gauge_open(void);

#ifdef __cplusplus
}
#endif

#endif
