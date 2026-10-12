# 0080. The plan is rewritten for parity with Nitro and Expo Modules

- **Date:** 2026-10-12
- **Status:** accepted

The plan's goal is that an author builds any module Nitro or Expo Modules
can build, views included, from one Lucent source. `docs/parity.md` lists
what each system offers an author and where Lucent stands, and the plan is
rewritten from scratch around it. ROADMAP.md, `docs/tasks.md` and
`docs/limitations.md` are replaced, with five gates: module parity, view
parity, execution modes, distribution and the production candidate. Task
ids start again at T100. Earlier ids stay in the history of
`docs/tasks.md` (at `1f72821d`), and its "Former task ids" table keeps an
anchor for each one still linked or still open.

Three kinds of work leave the plan:

- **The cross-platform view library** (T51, issue #29): primitives such as
  View, Row, Text and Image, and with it native lists (T55) and gestures
  and frame animation (T56). A component wraps a platform view, a SwiftUI
  body or a Compose body. Neither Nitro nor Expo Modules offers such a
  library to module authors.
- **Maintainer-only work:** physical-device runs (V8, and the device parts
  of T52, T64, T65 and TA41) and pilots with independent authors and apps
  (T68, T69). The plan covers engineering work an agent can do and check
  on hosts, simulators and emulators. A check that can't run is still
  never reported as a pass.
- **The final assessment** (T70) becomes the report of the production
  candidate.

Background work and the other execution modes are in scope: module code
that runs with no JavaScript runtime, Android classes the OS instantiates
written in Lucent, iOS background tasks, app extensions and widgets, and
calls from worklet runtimes. Core provides the mechanisms (entry points,
executors, lifecycle events, launch-time modules), and APIs such as a
background-task scheduler are Lucent packages built on them, so the
no-catalog rule holds.

_Why:_ the maintainer asked for the plan to be rebuilt from what is done
and what parity needs. Parts of the earlier plan were out of date, and the
UI library was out of scope. Background tasks were one task (T60) waiting
on the maintainer, though Expo's background tasks and widgets, and the
platform code Nitro authors write by hand, are part of what authors
build. _Changed:_ supersedes the gates G3 to G5 and the open tasks of the
earlier plan; [0007](0007-physical-device-checks-are-deferred.md)'s
deferred device checks leave the plan. Decisions
[0074](0074-a-window-of-stable-react-native-and-expo-releases.md) to
[0079](0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md)
stand, with new tasks: 0074 and 0079 are T140's, 0075 is T120's, 0076
T110's, 0077 T144's and 0078 T109's.
