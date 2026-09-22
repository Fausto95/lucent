// Lucent runtime — console.log / warn / error.
#pragma once

#include <functional>

#include "string.h"

namespace lucent {

enum class ConsoleLevel { Log, Warn, Error };
using ConsoleSink = std::function<void(ConsoleLevel, const String&)>;

/// Replaces the platform log (os_log / logcat / stdout), e.g. in tests.
void setConsoleSink(ConsoleSink sink);
void consoleWrite(ConsoleLevel level, const String& message);

}  // namespace lucent
