# Dragonbox

`dragonbox.h` from [Dragonbox](https://github.com/jk-jeon/dragonbox) by
Junekey Jeon, unmodified: the shortest decimal digits that read back as a
given double, and the closest of those to it. Hermes uses the same header
for JavaScript's Number::toString.

- Commit: beeeef91cf6fef89a4d4ba5e95d47ca64ccb3a44
- License: Apache License 2.0 with LLVM Exceptions, or the Boost Software
  License 1.0, at the user's choice. Lucent uses it under the Boost
  Software License (LICENSE-Boost).
- Used by `lucent/number.cpp` (Number::toString, toExponential()).

To update, copy `include/dragonbox/dragonbox.h` from a newer commit and run
`packages/runtime/test/run.sh`, whose number corpus compares every form with
node.
