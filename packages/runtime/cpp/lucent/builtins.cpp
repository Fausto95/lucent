#include <cstdio>

#include "async.h"
#include "bytes.h"
#include "console.h"

#if defined(__ANDROID__)
#include <android/log.h>
#elif defined(__APPLE__)
#include <os/log.h>
#endif

namespace lucent {

Array<String> split(const String& s, const String& separator) { return split(s, separator, 4294967295.0); }

Array<String> split(const String& s, const String& separator, double limitValue) {
  Array<String> out;
  double lim = std::isnan(limitValue) ? 0 : std::trunc(limitValue);
  size_t limit = lim <= 0 ? 0 : static_cast<size_t>(std::min(lim, 4294967295.0));
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

Promise<void> delay(double ms) {
  Promise<void> p;
  Scheduler::instance().postDelayed(ms, [p] { p.resolve(undefined); });
  return p;
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
