# 0105. A component's ref is its host view's own, with its commands on it

- **Date:** 2026-10-14
- **Status:** accepted

A Lucent component's ref is the host view React Native gives the native
view it renders (a `HostInstance`), with the commands setup exposes
assigned to it, as `TextInput`'s ref is a host view with `clear()` on it.
Its declared type is `HostInstance & { …commands }`. Before, the ref was
an object of the commands beside the host's `measure` and
`measureInWindow`.

A command can't take the name of a member the host view has (`measure`,
`measureLayout`, `setNativeProps`, the DOM node's, `__…`): `LUCENT3021`.
`focus` and `blur` may be commands: the host's send the native view the
command of their name, which reaches the component's.

_Why:_ what finds a view by its ref expects a host view. `findNodeHandle`,
`measureLayout`, Reanimated's `createAnimatedComponent` and Gesture
Handler's detectors read the host view or its tag from a ref, and an
object of commands has neither. React Native's own components that add
methods to their ref add them to the host view, so a library that
handles `TextInput` handles a Lucent component the same way.

_Changed:_ the ref (`runtime/js/views.js`), the declarations
(`ui/proxy.ts`), the names a command can't take (`ui/describe.ts`),
[views.md](../design/views.md#commands) and the website's components
page.
