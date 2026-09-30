#include "transport.h"

namespace lucent {

void throwDataCloneError(const char* message) {
  throwError(String::fromLatin1("DataCloneError"), String::fromUtf8(message));
}

}  // namespace lucent
