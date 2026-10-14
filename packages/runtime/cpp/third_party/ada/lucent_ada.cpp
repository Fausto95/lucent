// Ada, compiled without URLPattern, which Lucent doesn't offer and which
// brings std::regex. url/url.cpp includes ada.h with the same setting.
#define ADA_INCLUDE_URL_PATTERN 0
#include "ada.cpp.inc"
