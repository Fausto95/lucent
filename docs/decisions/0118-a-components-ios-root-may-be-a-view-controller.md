# 0118. A component's iOS root may be a view controller, which its host contains

- **Date:** 2026-10-15
- **Status:** accepted

A component's iOS code may return a UIKit `UIViewController`, such as
AVKit's `AVPlayerViewController`, as it returns a view: `UIViewController`
is a root class beside `UIView` (`ui/roots.ts`), recognized by ancestry
like the others. The mount gives the host the controller and its view,
and the host contains it as it does a SwiftUI body's hosting controller: a
child of the nearest view controller above the host, as soon as there is
one, in the host's layout direction, until the mount ends.

Unlike a hosting controller, a UIKit one sizes nothing itself, so the
host does what SwiftUI's options do (`plainController()` on `Mounted`):

- **Size.** Its style or flex sizes it, or its `preferredContentSize`
  when it has one. A controller tells its parent when that changes, and
  its parent is the screen's, so the host observes the property and
  measures again.
- **Safe area.** None, as a hosting controller's `safeAreaRegions = []`
  leaves SwiftUI's: what the window's safe area covers of the content
  goes back out of the controller as negative `additionalSafeAreaInsets`.

A setup returning a view on one path and a view controller on another is
refused (LUCENT3020), as is one mixing a view and a `Fragment` on
Android: the host takes one kind of root.

_Why:_ some iOS UI comes only as a view controller, such as
`AVPlayerViewController`, whose controls, fullscreen and picture in
picture its controller drives. Containment is what UIKit asks for a
controller's view shown in another's, and what gives it its parent's
appearance calls and traits, which the SwiftUI host already does.
Leaving the size to the style keeps a controller that reports none from
collapsing the component, and no safe area keeps a component's content
where Yoga put it, as React Native's own views are.
_Changed:_ [views.md](../design/views.md#ios) and
[limitations.md](../limitations.md).
