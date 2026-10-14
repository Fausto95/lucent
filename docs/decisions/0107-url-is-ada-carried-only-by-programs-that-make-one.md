# 0107. URL is Ada, carried only by programs that make one

- **Date:** 2026-10-14
- **Status:** accepted

`URL` and `URLSearchParams` are built on [Ada](https://github.com/ada-url/ada)
v3.4.4, the WHATWG URL parser Node uses, vendored in
`runtime/cpp/third_party/ada` from its single-header release (Apache 2.0
and MIT). `lucent/url/url.cpp` is the only file that includes `ada.h`; `url.h`
declares the classes with Ada behind a pointer, so the umbrella header
carries none of it. Ada is compiled without URLPattern
(`ADA_INCLUDE_URL_PATTERN=0`), which brings `std::regex`: its `ada.cpp` is
vendored unchanged as `ada.cpp.inc` and compiled through `lucent_ada.cpp`.
A query's names and values are decoded as the standard says, where Ada
keeps bytes a percent-escape gave that aren't UTF-8.

A native package carries `lucent/url/url.cpp` and `third_party/ada` only when
the program makes a `URL` or `URLSearchParams` (the emitter's `urls`). The
prebuilt core has both, as objects an app links only when its code calls
them.

_Why:_ the URL standard is long, and its host parsing needs IDNA's Unicode
tables: a parser of Lucent's own would be large and would differ from
JavaScript's in its edge cases. Ada passes the web platform tests and is
what Node runs, so the e2e case compares with the same parser. It is half
a megabyte of code, which an app that never makes a URL should neither
compile nor link: a build from source compiles every file it is given,
and Android links each into the app's library.
_Changed:_ [semantics.md](../semantics.md), [T105](../tasks.md#t105),
[limitations.md](../limitations.md).
