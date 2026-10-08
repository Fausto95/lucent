// Lucent runtime — the prefix header the native builds precompile.
//
// lucent.h is most of what every generated unit parses (the standard
// library included): precompiled once per build, a unit that includes
// it again costs nothing more. The C sources (the vendored regular
// expression engine) and Objective-C code see nothing of it.
#pragma once

#if defined(__cplusplus)
#include "lucent.h"
#endif
