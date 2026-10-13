// Lucent runtime — umbrella header included by generated code.
#pragma once

// Recursion without end is a program JavaScript runs (it throws RangeError,
// as checkStack makes Lucent's do): not a warning in generated code, which
// device builds compile with -Werror.
#if defined(__clang__)
#pragma clang diagnostic ignored "-Winfinite-recursion"
#elif defined(__GNUC__) && __GNUC__ >= 12
#pragma GCC diagnostic ignored "-Winfinite-recursion"
#endif

#include "abort.h"
#include "array.h"
#include "async.h"
#include "bigint.h"
#include "buffer.h"
#include "bytes.h"
#include "callback.h"
#include "channel.h"
#include "console.h"
#include "conversions.h"
#include "core.h"
#include "date.h"
#include "equality.h"
#include "events.h"
#include "extension.h"
#include "jserror.h"
#include "function.h"
#include "generator.h"
#include "helpers.h"
#include "hooks.h"
#include "json.h"
#include "json_parse.h"
#include "map.h"
#include "native.h"
#include "number.h"
#include "refs.h"
#include "regexp.h"
#include "report.h"
#include "resource.h"
#include "ops.h"
#include "scheduler.h"
#include "stack.h"
#include "timers.h"
#include "weak.h"
#include "jsstring.h"
