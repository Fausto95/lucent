---
"@lucent-lang/lucent": patch
---

A component's generated C++ drops what no host called: `registerComponents` (and `views/lucent_views.cpp`; `lucent_views.h` stays, the marker the hosts build by) and `Mount::setEmit`, since the host's event route already sends to the emitter of the view's current commit.
