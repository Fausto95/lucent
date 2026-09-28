/*
 * A C interface over the Orbit filter (orbit_filter.cpp, C++). Nothing C++
 * crosses it: every function catches what the implementation throws and
 * reports it through OrbitError.
 */
#ifndef ORBIT_FILTER_H
#define ORBIT_FILTER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct OrbitFilter OrbitFilter;

typedef struct {
  int code;
  const char* message;
} OrbitError;

/* A filter scaling bytes by `strength` (0 to 4); null, with the error, otherwise. */
OrbitFilter* orbit_filter_create(double strength, OrbitError* error);

void orbit_filter_destroy(OrbitFilter* filter);

/* Writes the scaled input to output; the count written, or -1 with the error. */
int orbit_filter_apply(OrbitFilter* filter, const uint8_t* input, size_t input_length,
                       uint8_t* output, size_t output_length, OrbitError* error);

/* How many bytes the filter has scaled. */
uint64_t orbit_filter_processed(const OrbitFilter* filter);

/* How many filters exist: created and not destroyed. */
int32_t orbit_filter_live(void);

/* The length of a label, in bytes: a string argument. */
int32_t orbit_filter_label(const char* name);

/* Not bound: a callback Lucent cannot pass yet. */
void orbit_filter_each(OrbitFilter* filter, void (*visit)(uint8_t value, void* context),
                       void* context);

#ifdef __cplusplus
}
#endif

#endif
