#include "presentation.h"

namespace lucent {

Error sceneGoneError() { return makeError(String::fromLatin1("AbortError"), String::fromLatin1("The scene disconnected")); }

Error noSceneError() {
  return makeError(String::fromLatin1("InvalidStateError"), String::fromLatin1("No scene is in the foreground to present from"));
}

}  // namespace lucent
