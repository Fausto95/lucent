# QuickJS regular expression engine

`libregexp`, `libunicode` and `cutils` from [QuickJS](https://github.com/bellard/quickjs)
by Fabrice Bellard and Charlie Gordon (MIT, see LICENSE), unmodified.

- Commit: 04be246001599f5995fa2f2d8c91a0f198d3f34c (VERSION 2026-06-04)
- Used by `lucent/regexp.cpp`, which supplies `lre_realloc`,
  `lre_check_stack_overflow` and `lre_check_timeout`.

To update, copy the same files from a newer QuickJS checkout and run the
e2e `regexps` case.
