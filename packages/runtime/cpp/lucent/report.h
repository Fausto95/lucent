// Lucent runtime — the one place errors nobody can catch are reported.
#pragma once

#include <exception>

namespace lucent {

/// Reports an error no Lucent code can catch: thrown by a job, a microtask,
/// a cleanup, or a callback the platform made. `where` names the source.
void reportUncaught(std::exception_ptr e, const char* where);

/// Logs an error where the platform shows an app's errors (logcat, the
/// unified log) and to stderr.
void logError(const char* message);

}  // namespace lucent
