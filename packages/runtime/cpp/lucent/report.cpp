#include "report.h"

#include <cstdio>
#include <exception>
#include <string>

#if defined(__ANDROID__)
#include <android/log.h>
#elif defined(__APPLE__)
#include <os/log.h>
#endif

namespace lucent {

namespace {
/// Where each platform shows an app's errors: logcat, the unified log, and
/// stderr (host runs; Android and release iOS apps drop it).
void writeError(const std::string& message) {
#if defined(__ANDROID__)
  __android_log_write(ANDROID_LOG_ERROR, "Lucent", message.c_str());
#elif defined(__APPLE__)
  os_log_error(OS_LOG_DEFAULT, "%{public}s", message.c_str());
#endif
  std::fprintf(stderr, "%s\n", message.c_str());
}
}  // namespace

void logError(const char* message) { writeError(message); }

void reportUncaught(std::exception_ptr e, const char* where) {
  try {
    std::rethrow_exception(e);
  } catch (const std::exception& x) {
    writeError(std::string("[lucent] uncaught exception in ") + where + ": " + x.what());
  } catch (...) {
    writeError(std::string("[lucent] uncaught exception in ") + where);
  }
}

}  // namespace lucent
