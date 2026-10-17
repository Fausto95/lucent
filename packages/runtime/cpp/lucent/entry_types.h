// Lucent runtime — the C types a native entry point passes (decisions 0091
// and 0116), and lucent_release: C alone, so that Swift, Objective-C and C
// include it, as the generated lucent_entries.h does. entries.h says how
// an entry runs.
//
// Strings and bytes are UTF-8 and bytes with a length. What else crosses,
// an optional, an array, a record or a platform object, is a lucent_value:
// a kind, and the value of that kind. An array's items and a record's keys
// and values are lucent_values too. An instance of an exported class is a
// lucent_object, which an entry gives its caller to own: lucent_release
// lets it go.
//
// Guarded by a macro, not #pragma once: a pod built as a framework has two
// copies, its Headers/ one, which the module map names, and the source one
// lucent_entries.h reaches by its path. #pragma once tells files apart, so
// both copies' types would be defined in one module.
#ifndef LUCENT_ENTRY_TYPES_H
#define LUCENT_ENTRY_TYPES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// UTF-8, not terminated: `length` bytes from `data`.
typedef struct lucent_string {
  const char* data;
  size_t length;
} lucent_string;

typedef struct lucent_bytes {
  const uint8_t* data;
  size_t length;
} lucent_bytes;

/// An Error Lucent code threw: its name ("RangeError"), message and code
/// (empty without one).
typedef struct lucent_error {
  lucent_string name;
  lucent_string message;
  lucent_string code;
} lucent_error;

/// What a lucent_value holds: LUCENT_NULL for an optional's absent value.
typedef enum lucent_kind {
  LUCENT_NULL = 0,
  LUCENT_BOOLEAN = 1,
  LUCENT_NUMBER = 2,
  LUCENT_BIGINT = 3,
  LUCENT_STRING = 4,
  LUCENT_BYTES = 5,
  LUCENT_ARRAY = 6,
  LUCENT_RECORD = 7,
  /// A platform object: an `id` on iOS, a `jobject` on Android.
  LUCENT_PLATFORM_OBJECT = 8,
  /// An instance of an exported class.
  LUCENT_INSTANCE = 9,
} lucent_kind;

/// An instance of an exported class that native code holds, with its
/// module's state: an entry gives one its caller owns.
typedef struct lucent_object_s* lucent_object;

/// Lets go of an instance an entry gave, on any thread; then of module
/// state, once nothing else holds it. Nothing for null.
void lucent_release(lucent_object object);

typedef struct lucent_value lucent_value;

typedef struct lucent_array {
  const lucent_value* items;
  size_t length;
} lucent_array;

/// A `Record<string, T>`: `length` keys, and the value of each.
typedef struct lucent_record {
  const lucent_string* keys;
  const lucent_value* values;
  size_t length;
} lucent_record;

struct lucent_value {
  lucent_kind kind;
  union {
    bool boolean;
    double number;
    int64_t bigint;
    lucent_string string;
    lucent_bytes bytes;
    lucent_array array;
    lucent_record record;
    void* object;
    lucent_object instance;
  } as;
};

#ifdef __cplusplus
}
#endif

#endif  // LUCENT_ENTRY_TYPES_H
