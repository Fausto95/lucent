# 0104. A component's Android root may be a Fragment, which its host contains

- **Date:** 2026-10-14
- **Status:** accepted

A component's Android code may return an androidx `Fragment`, as iOS code
returns a view: `Fragment` is a root class beside `View` (`ui/roots.ts`).
The mount gives the host the fragment and no view. The host's shell holds
a container, a `FrameLayout` with an id of its own, and the fragment goes
over it through the Activity's `FragmentManager` once the shell is in a
window (`commitNowAllowingStateLoss`, tagged `dev.lucent.component`). The
fragment's view sizes the component as other content does. It leaves the
manager when the mount ends, or when a setup run again returns another.

When Android recreates an Activity, it restores the Activity's fragments,
and their containers went with the old views. `LucentActivities` removes
the restored fragments with that tag as the Activity is created again,
before Android makes their views, and their components mount new ones. A
Lucent `Fragment`'s constructor runs for the restored one, so its module
sees it made.

A Lucent class instance a setup gives the platform stays refused
(`LUCENT3021`), a fragment as any other: its methods would run in module
code while the setup's run on the main thread without the lock. A module
function makes it, and its methods run in module code, as any Lucent
object's the platform calls.

_Why:_ some Android UI comes only as a fragment, such as Google Maps'
`SupportMapFragment`, and an app's `FragmentActivity` is where Android
keeps it. A container of the shell's own keeps the fragment's view inside
the component, which React Native lays out. Android looks a restored
fragment's container up by its id, and finds none: dropping the fragment
keeps the Activity from failing, as `react-native-screens` asks apps to do
by passing no state to `super.onCreate`. The runtime's host of fragments
is built only for a program with such a component, and compiles against
androidx.fragment as the app has it, through React Native's AppCompat.
_Changed:_ [views.md](../design/views.md#android) and
[limitations.md](../limitations.md).
