# QuickJS regular expression engine

`libregexp`, `libunicode` and `cutils` from [QuickJS](https://github.com/bellard/quickjs)
by Fabrice Bellard and Charlie Gordon (MIT, see LICENSE), unmodified but
for one line: `cutils.h`, `libregexp.h` and `libunicode.h` begin by
including `lucent_prefix.h`, which renames every global symbol to
`lucent_…`, so an app that links another QuickJS has no clash.

- Commit: 04be246001599f5995fa2f2d8c91a0f198d3f34c (VERSION 2026-06-04)
- Used by `lucent/regexp.cpp`, which supplies `lre_realloc`,
  `lre_check_stack_overflow` and `lre_check_timeout`.

To update, copy the same files from a newer QuickJS checkout, add the
include line back to the three headers, regenerate `lucent_prefix.h` from
`nm -g --defined-only` of the three objects (plus the three callbacks
above), and run the e2e `regexps` case and `packages/runtime/test/run.sh`
(its `symbols` check fails on any global symbol left unprefixed).
