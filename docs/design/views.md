# Views: Lucent components in React Native's renderer

Status: implemented behind `LUCENT_VIEWS=fabric`, an internal switch that
is off by default. Without it, components are only described and none of
what follows is generated.

A component is an exported function of a `.lucent.tsx` module that
returns a platform view (a `UIView` or an Android `View`). Its setup is
compiled to C++, runs on the main thread once per mount, and returns the
view React Native shows. JavaScript sees a React component with the
component's props, its events as callback props, and a ref whose methods
are the commands setup exposes: a void command runs, and a request answers
a promise. [architecture.md](../architecture.md) describes how the
compiler generates each piece. This record covers what the platform hosts
do with them at run time.

## Platform registration

Each component has a registration name, derived from its identity, and a
Fabric descriptor generated from its description (`views/<name>.h`: its
`Props`, `EventEmitter`, `ShadowNode` and `ComponentDescriptor`).

**iOS.** Each component gets `views/<name>ComponentView.mm`, a subclass of
the shared host `LucentComponentView` (`runtime/cpp/rn`), which derives
from React Native's `RCTViewComponentView`. The subclass:

- registers itself with `RCTComponentViewFactory` from `+load`, before
  any surface starts;
- gives the factory its descriptor (`componentDescriptorProvider`);
- sets `_props` to the component's default `Props` in `initWithFrame:`,
  as React Native's own component views do, so the base class reads its
  props as the component's own from the first update;
- mounts the component's `Mount` for the host (`lucentMount:host:`), and
  tells a request command from a void one (`lucentRequestId:args:`).

React Native keeps a pool of recycled views per component type, and
reuses one for the next view of that type.

**Android.** Android mounts views from Java, so the host is split:

- Each component gets a manager, `dev.lucent.generated.<name>Manager`, a
  `LucentViewManager` named as the component is registered. The
  generated `LucentViewManagers` lists them, and `LucentPackage`
  returns the list from `createViewManagers`. Every manager's view is a
  `LucentHostView`, a `FrameLayout` shell that holds the view setup
  returns and fills it.
- `lucent build` lists each component's descriptor for React Native's
  autolinking (`componentDescriptors` in the native package's
  `react-native.config.js`, with the `ComponentDescriptors.h` header
  autolinking includes), wrapped in `HostDescriptor`
  (`LucentViewsAndroid.h`). When the renderer creates a descriptor, the
  wrapper binds the host's natives (`dev.lucent.LucentViews`) and
  registers itself for props parsing. For each new view family, it
  records the view's event emitter by surface and tag
  (`LucentViewRegistry.h`), because Java never passes the emitter on.
  A tag alone would not do: each JavaScript runtime numbers its views
  again, so across a reload an old surface's view and a new one's share
  tags, while surfaces are numbered for the process.
- `views/<name>_android.cpp` adapts the component's `Mount` to the host,
  and `views/lucent_hosts.cpp` lists every component by registration name
  (`findComponent`).
- The managers call `setupViewRecycling()`. React Native then pools
  dropped views when the app turns its `enableViewRecycling` feature
  flag on. The flag is off by default, and then every view is new.

## The mount lifecycle

One mount is one run of setup, on one host view, for as long as that
view shows that component instance.

| Step    | iOS (`LucentComponentView`)                                    | Android (`LucentViewsAndroid.cpp`)                                                                                                  |
| ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| props   | `updateProps:` keeps the commit's full `Props`                 | `updateProperties` passes the commit's changed props; the host merges them into its last `Props` with the descriptor's `cloneProps` |
| create  | `finalizeUpdates:`, for the first commit that reaches the view | `onAttachedToWindow`, or the first command if one comes before it                                                                   |
| update  | `finalizeUpdates:` for each later commit                       | `updateProperties` for each later commit, once mounted                                                                              |
| command | `handleCommand:args:`                                          | `receiveCommand`                                                                                                                    |
| dispose | `prepareForRecycle`, or `dealloc`                              | `prepareToRecycleView`, or `onDropViewInstance`                                                                                     |

- **Create.** The host gives the mount a `MountToken` {tag, generation}.
  The generation is process-unique and never 0, and 0 means no mount.
  Then it calls `Mount::create` with the committed props and the host's
  event route. Setup runs once in the mount's scope, and its view
  becomes the host's content: iOS `contentView`, Android the shell's
  child. Android waits for the attach because React Native can create
  (preallocate) a view before its props are committed.
- **Update.** `Mount::update(props, previous)` puts the props that
  changed, and which events JavaScript listens to, into the mount's prop
  inbox as one transaction. On the main thread it applies them at once.
  Effects that read a changed prop run again, and setup does not.
- **Command.** The host reads a command's arguments with the component's
  generated parser. A request whose arguments do not parse, or that
  reaches a view without a mount (setup failed), is rejected at once. A
  mount runs its pending props before the command.
- **Dispose.** The host sets the token's generation to 0, removes the
  content view and destroys the mount. `Mount::dispose` closes the prop
  inbox, disposes the mount's scope (effects stop and `onDispose`
  cleanups run), clears its events' routes, releases the host's event
  route and the view, rejects the requests it still owes, and does
  nothing after the first call. Nothing of the mount reaches the host
  afterwards. On Android the
  host itself is freed. A recycled view's next commit creates a new mount
  with a new token.
- **Reload.** When JavaScript reloads, React Native tears down the
  surface, and the views it drops dispose their mounts. The new runtime's
  views mount afresh. Answers meant for the old runtime are dropped (see
  below). A debug build then reports the platform objects module code
  still holds (`moduleNativeRefs`: module state, listeners never
  removed), once the module context has run what the teardown left it.
  The views' own objects are left out: whatever the main context made
  (setups, the callbacks they give the platform) is released as the
  renderer drops its views, and a callback the platform held until its
  garbage collector runs (an Android listener set to null in
  `onDispose`) lets go of its captures only then, so on an Android
  reload such objects can outlive the module by seconds. So is the
  Android Application, which `appContext()` keeps for the process.

## Events, requests and threads

**Events.** Calling an event prop in setup code (`props.onChange?.(v)`)
sends the arguments along the event's route. The route delivers only
while JavaScript listens to that event (the commit's handler bits) and
before the mount is disposed. The host's route then asks the host view
for its event emitter, which is null unless the view still holds this
mount's token, and dispatches through React Native's `EventEmitter`. The
payload is `{ args: [...] }`, built on the JavaScript thread. Events wait
in React Native's event queue while JavaScript is busy. JavaScript's
handler runs late, but the native side never waits for it.

Each event has a delivery, which the contract records and the event
emitter follows:

| Delivery               | How the prop's type says it  | React Native                     | JavaScript hears                                        |
| ---------------------- | ---------------------------- | -------------------------------- | ------------------------------------------------------- |
| discrete (the default) | `(v: T) => void`             | `RawEvent::Category::Discrete`   | every event, at React's discrete priority               |
| continuous             | `Continuous<(v: T) => void>` | `RawEvent::Category::Continuous` | every event, at a lower priority (React may batch them) |
| coalesced              | `Coalesced<(v: T) => void>`  | `dispatchUniqueEvent`            | the latest value of a run of events still waiting       |

`Continuous` and `Coalesced` come from `lucent:ui`; marking an event both
ways is refused. A view's events reach JavaScript in the order setup sent
them. A coalesced event replaces the view's waiting event only when that
is the view's latest waiting event and of the same type, and it takes
that event's place in the queue: another view's event queued in between
then comes after it. React Native 0.88 maps the continuous category to
React's default priority unless its
`fixMappingOfEventPrioritiesBetweenFabricAndReact` flag is on. A view's
events and its requests' answers travel on different channels, so no
order holds between the two.

An event goes to the callback of the commit React has when it handles
the event: a replaced callback gets none, and once the callback is
removed the view hears that JavaScript no longer listens and sends
nothing.

**Requests.** The JavaScript side of a ref gives each request an id and
keeps it pending per mount. The native host captures the `Requester` of
the runtime connected when the command arrives (`__lucentViewRequests`),
and the mount answers through it, once per request:

- a command returning a value answers at once; one returning a promise
  leaves the answer owed in the mount's table until the promise settles
  (its continuation holds the mount only weakly);
- when the mount is disposed, what it still owes is rejected
  (`<Component> unmounted before answering`), and a promise settling
  later finds nothing owed: its work is not cancelled, as JavaScript's
  promises are not, but its answer goes nowhere (setups stop their work
  with `onDispose`);
- the host answers through `answerTo(host, requester)`, which drops an
  answer unless the view still holds the mount that answers (its whole
  `MountToken`): a recycled or remounted view never receives its
  predecessor's answers;
- the answer is posted to that runtime's JavaScript thread, where
  `settle(id, error, value)` resolves or rejects the promise;
- an answer for a torn-down runtime is dropped, and what it carries is
  released on the module context;
- when a component unmounts, its pending requests are rejected with an
  `AbortError` (`<Component> unmounted before answering.`), and a later
  answer for one of them is ignored;
- a command sent while the view is not mounted (before React attached
  it, or after it unmounted) fails with an `InvalidStateError` (`the
view is not mounted`): thrown by a void command, the rejection of a
  request;
- a failure the native side reports (the command threw, its arguments
  did not parse, the view has no mount) rejects with an `Error` of its
  message.

Each request's promise therefore settles exactly once.

**Threads.** Every entry point of a mount runs on the platform's main
thread and enters Lucent's main context itself (`ContextEntry`), so a
host calls it from UIKit or the Android main looper as it is. The main
context never takes the Lucent lock. Entering it while holding the lock
throws.

| Work                                                                  | Thread                                      | Waits for       |
| --------------------------------------------------------------------- | ------------------------------------------- | --------------- |
| setup, effects, commands, dispose; callbacks setup gives the platform | main (main context)                         | nothing         |
| `Mount::update` called off the main thread                            | posted to the main context                  | nothing         |
| event payloads, request answers                                       | posted to the JavaScript thread             | nothing         |
| module code (exports, module callbacks)                               | the calling thread, holding the Lucent lock | the Lucent lock |
| compute tasks                                                         | a worker (an isolated context)              | a free worker   |

The hosts hold four short mutexes, none across a call into Lucent or
React code:

- the Android registries: descriptors by name (also held while one
  commit's props are parsed, so that the descriptor is not destroyed
  meanwhile), and event emitters by surface and tag;
- the request connection (a pointer copy);
- each mount's prop inbox.

No host waits synchronously for another thread.

One path does wait. When UIKit or Android calls module code on the main
thread (an override of a platform class, a callback that module code
registered, a lifecycle listener), that code takes the Lucent lock, and
waits while JavaScript runs module code. A component setup's own
callbacks run in the main context instead and never take the lock.

### Isolation, measured

The views spike (`scripts/views-spike.ts`, `apps/bare-example/.views-spike`)
shows a label that a native timer updates every 100 ms on the main thread
(an iOS `Timer`, an Android `TimeAnimator`). Each tick is logged with its
time and sent to JavaScript as an event. Four phases ran on the iOS
simulator and the Android emulator, in both example apps:

- JavaScript blocked for 3 s;
- a 500 ms compute task;
- module code holding the Lucent lock on the JavaScript thread for 1 s;
- a 500 ms compute task while JavaScript blocked for 2 s.

In every phase, the native ticks went on at their period. The longest
gap between two ticks was 101 ms on the simulator and at most 188 ms on
the emulator, whose frame-driven animator ticks on the first frame after
each 100 ms. JavaScript heard the ticks of a block only once it ended, about
the block's length late (2.9 to 3.4 s for a 3 s block), and heard them
within 160 ms (1 ms on the simulator) during a compute task. With the runtime's
tracing on (iOS signposts), the main thread never waited for the Lucent
lock: its posted jobs waited at most 4 ms and ran for at most 1 ms,
while the JavaScript thread held the lock for the 1 s of module code.
Under heavy load on the host machine, one emulator run showed gaps of
3 s; runs at normal load did not.

Physical devices and frame timing on them: deferred (user).

## Toolkit bodies

A component can draw its view with the platform's declarative toolkit
instead of platform views: SwiftUI on iOS (`lucent:swiftui`), Jetpack
Compose on Android (`lucent:compose`). Both modules resolve under the
same internal switch. `lucent:swiftui` declares SwiftUI as the SDK
declares it; `lucent:compose` a few of Compose's own names. The
setup gives its body, a function, to the toolkit's body function
(`swiftUI(() => …)`, `compose(() => …)`) in its own code, once, and
returns what that makes: the object the host shows. The body is written
out in the toolkit's language; the rest of the setup is Lucent code, as
in any component (signals, effects, commands, timers, events). Bodies are
calls of the toolkit's own functions, never JSX; the component's module
is a `.lucent.tsx` file, as every component's is.

The body and its setup meet through slots, the same way on both
platforms (`ui/toolkit-body.ts`, `emit/toolkit.ts`):

- Plain data the body reads from the setup (`on.get()`, `props.title`, a
  template of them, what a setup function returns, an object, an array)
  is a value slot. The largest such expression is one slot, computed by
  the setup's C++ with JavaScript's semantics. An effect of the mount
  computes it when the mount starts and again whenever what it read
  changes, on the main thread, and sets the toolkit's state, so the body
  draws again with the value of the latest commit. A number, a boolean or
  a string crosses as it is. Any other value (an object, an array, a
  value that may be null) crosses encoded (`emit/toolkit-values.ts`):
  Foundation objects on iOS, boxed Java objects on Android, an object
  being an array of its fields in the order its type declares them. The
  body reads it back as a Swift struct or a Kotlin data class.
- A setup function the body calls from a callback, or passes as one, is
  an action slot. The toolkit calls it on the main thread, and it runs in
  the main context, entering its mount like any function the setup made,
  so the host measures what it changed. The callback gives it its
  arguments: the callback's own parameters (the text a field changed
  to), literals and values the setup computes, each a number, a boolean
  or a string crossing back into Lucent. SwiftUI passes them in an array
  through the action's C function; Compose, as the boxed arguments of a
  Kotlin function object.
- An array the setup computes, shown item by item, is a list slot:
  SwiftUI's `ForEach(items, { id: (item) => item.id }, (item) => […])`,
  a Compose list form, LazyListScope's `items` in a `LazyColumn`'s
  content (`list.items(items, (_, item) => […], { key: (item) => item.id
})`), which Lucent recognizes by its schema (a list of T, a content
  lambda given a T, a `key` callback of a T). The key function
  gives each item a key, a string or a number, unique in the array. What
  an item shows reads the item and the setup: each value it reads is the
  item's own slot, computed by the setup's C++ for each item. An effect
  keys the array, computes each item's values, and sends the toolkit
  records of them (`[key, value…]`), which the toolkit merges by key: an
  item keeps its model (an `ObservableObject` and a row view on iOS,
  holders of Compose state on Android), updated in place, as long as its
  key stays, and the list itself changes only when the keys or their
  order do. A callback of an item may give a setup function the item
  itself: it crosses as its key, and the setup's C++ finds the item again
  (or does nothing once it is gone). Two items with one key, or a NaN
  key, are an error of the effect. An item shows no list of its own, for
  now.
- `bind(signal)` (lucent:ui) gives a setup signal of a number, a
  boolean or a string to a view that changes it: SwiftUI's `Binding`
  (`TextField("New", { text: bind(draft) })`, `Toggle("Done", { isOn:
bind(done) })`), or Compose's value and its change callback, where a
  declaration pairs them (`BasicTextField({ value: bind(draft) })`). The
  view reads the signal's value slot. A change the user makes is an
  action setting the signal on the main thread, in its mount; the slot's
  effect sets the value back at once, so the view shows what the signal
  keeps. `bind` is written only where a view takes it, and not in a
  list's item.
- What the toolkit provides where the body draws is read there, in the
  toolkit's language. SwiftUI's environment is read with
  `Environment((values) => values.colorScheme)`: a property of the view
  reading it (`@Environment(\.colorScheme)`, the body's view or a list's
  row), which content may compare (`=== ColorScheme.dark`) and a callback
  may pass to the setup. Compose's composition locals
  (`LocalConfiguration.current`) and composables such as
  `isSystemInDarkTheme()` are read where the body composes; read in a
  callback, they fail with LUCENT3024.
- The body holds no logic of its own. It doesn't change the setup's
  state, send events, call a setup function while it draws, or read the
  setup's other values. A body Lucent can't write out, and the toolkit's
  views and values used outside a body, fail with LUCENT3024.

The views spike's list screen (`scripts/views-spike.ts --entry list.js`)
ran on the iOS simulator and on the Android emulator (view recycling on),
a todo list written once for each toolkit. Commands added todos (each
animated in), toggled one, typed into the bound field, hid and showed the
done ones through the bound switch, removed one and renamed the list;
each change reached JavaScript as an event 0 to 30 ms later, and the host
measured the list again as it grew and shrank. Real taps then toggled an
item and removed another through the item's key, flipped the bound
switch (the done items went, "nothing to do" appeared), and added the
field's text, which cleared the field through the signal. On Android,
text typed into the field reached the signal and the added item; there
the list is a LazyColumn's items, its rows weighted through their Row's
scope, and the switch material3's Switch bound to a signal. The color
scheme (iOS) and the screen's density with the dark theme (Android),
read where the body draws, reached the setup through a callback.

## SwiftUI content

An iOS component draws with SwiftUI by returning `swiftUI(() => …)`. The
body is SwiftUI's own calls, by their Swift names:

```tsx
export function Toggle(props: { title: string }): UIHostingController {
  const on = signal(false);
  const flip = () => {
    on.set(!on.peek());
  };

  return swiftUI(() =>
    VStack({ spacing: 8 }, [
      Capsule()
        .fill(on.get() ? Color.green : Color.gray)
        .frame({ width: 56, height: 32 })
        .animation(Animation.spring({ response: 0.35 }), { value: on.get() })
        .onTapGesture(() => flip()),
      Text(`${props.title}: ${on.get() ? "on" : "off"}`),
    ]),
  );
}
```

Swift's unlabeled arguments are given in order, its labeled ones as one
object literal, a view's content as an array after them, and a trailing
action as a function. The body is one view: the function returns it.
Content given in the object (a `Slider`'s `label: [Text("Level")]`) is a
closure too, wherever Swift takes it.

**Declarations.** `lucent:swiftui` is generated from the SwiftUI of the
installed SDK (with SwiftUICore, which is part of it), not written by
hand: SwiftUI's views and values are called by their type's name
(`Text("a")`, `Color(…)`), its statics and cases are values of it
(`Color.green`, `Edge.Set.horizontal`), and View's modifiers are
methods. Each overload is one way to write one of SwiftUI's members, and
Lucent writes the call with that member's labels, in its order. Swift
resolves the call itself, as it would the same call written by hand. A
parameter with a default may be left out; one whose type a body cannot
write (a `CGSize`, a `Date`) is never given.

**Numbers and ranges.** A value of any floating-point or striding type
(SwiftUI's generic `V: BinaryFloatingPoint`, `V: Strideable`: a
`Slider`'s, a `Stepper`'s, a `ProgressView`'s) is a Lucent number, a
Double in Swift, and so is its step (`V.Stride`). A range of them is
`range(from, to)` (lucent:ui), Swift's closed range `from ... to`, its
bounds literals or values the setup computes. Like `bind`, it is
written only where a view takes it:

```tsx
Slider({ value: bind(level), in: range(0, 1), step: 0.1 });
Stepper("Count", { value: bind(count), in: range(1, props.max) });
```

**Values of any scalar type.** A value of a type parameter that any
Lucent number, string or boolean fits (SwiftUI's `V: Equatable`,
`SelectionValue: Hashable`) is a TypeScript type parameter too, one per
Swift one: `onChange({ of: level.get() }, (now) => leveled(now))` gives
its callback a number, and a `Picker`'s selection binds a signal of any
of them (`Picker("Size", { selection: bind(size) }, [Text("S").tag("s")])`).
A number literal given as one is a Double in Swift, the type of a number
signal's Binding. A callback may take fewer values than SwiftUI gives
it. Where SwiftUI has several forms of a member, the declarations offer
first what every supported iOS has, then the forms whose callbacks take
the most values: `onChange`'s callback gets the new value (iOS 14's
form); the one giving the old value too needs iOS 17.

**What is Swift.** Lucent writes the body out as SwiftUI code: a `View`
struct, an `ObservableObject` model and `@_cdecl` functions, built with
the app's other Swift. SwiftUI's views, modifiers and values, and
literals, are Swift. A value slot is a `@Published` property of the
model, which the slot's effect sets. A callback is a Swift closure
calling the setup's functions by index. A conditional view in a view's
content is SwiftUI's `if`: `shown.get() && Text("a")`, or a ternary,
whose branch may be `null` (content takes `false`, `null` and
`undefined` for a view left out). The condition is a boolean, which the
setup computes like any value; one that is not (a number, a boolean
that may be undefined) fails with LUCENT3024.

**Animations** are SwiftUI's. The body animates with its modifiers
(`animation(_:value:)`). Lucent code calls `withAnimation(animation,
body)`: SwiftUI's withAnimation runs around `body`, and the effects of
what `body` writes run before it returns, so the model's changes animate.
The animation is written out in Swift: SwiftUI's values and literals
as they are, and the numbers, booleans and strings Lucent code computes
for it (`Animation.spring({ response: speed.peek() })`) as arguments of
its shim, computed in order when withAnimation runs. A conditional view
moves in and out with its `transition` when the change is animated.

**Hosting.** Setup returns the `UIHostingController` the Swift side
makes, one per mount: a recycled host's next mount makes its own, and
when a mount ends, its controller, the model and what they hold go with
it. A controller UIKit keeps a little longer (a closing sheet's) reaches
no mount: its actions and size reports do nothing, as SwiftUI's
`onDisappear` of an unmounted body does.

The host shows the controller's view as the content view, and contains
the controller in the nearest view controller above the host
(`addChildViewController:` and `didMoveToParentViewController:`) as soon
as there is one, before its view goes into a window. UIKit then calls
the controller's appearance methods with its parent's, a pushed screen's
`viewWillAppear:` included, and the parent's traits reach it: the colour
scheme, the text size. The controller stays that child when the host
leaves the window (a popped screen's views leave it before its
`viewDidDisappear:`), until the host is under another view controller or
the mount ends. The host is no accessibility element of its own:
VoiceOver reads the body's elements, which the hosting view publishes.

The host's layout direction, Yoga's, is the controller's layout
direction trait, which SwiftUI lays its content out by (`traitOverrides`,
iOS 17 and later; before, the parent overrides its child's traits).
React Native gives its views the direction as their semantic content
attribute, which SwiftUI does not read.

The controller takes no safe area insets (`safeAreaRegions` empty, iOS
16.4 and later): React Native places the host's box, and an app keeps
it clear of the screen's edges as it does any view. Sizing is the same
as for other views: the host measures the hosting view with
`sizeThatFits:`. The controller also tracks its content's ideal size
(`sizingOptions` `.preferredContentSize`, iOS 16 and later), and a
change of it, SwiftUI's own too with no Lucent code running, marks the
mount's content changed: the host measures it again on a later turn of
the main thread. The report goes to the host only: the controller keeps
the size itself and never calls UIKit's `preferredContentSize` setter,
which would tell its parent view controller, and a sheet or a popover
would resize to it.

The views spike's toggle screen (`scripts/views-spike.ts --entry
toggle.js`) ran on the iOS simulator. Its knob springs across on each
flip, whether a command, a tap or a native timer flips it, and a tap's
event reaches JavaScript 1 to 3 ms later. `pulse()` scales the toggle
with withAnimation, a new title prop reaches the SwiftUI text and the
host measures its new width, and a remounted toggle starts from its
initial state. While JavaScript was blocked for 3 s, the timer's flips
went on every 800 ms, each one animated and counted, and JavaScript
heard of them when the block ended. After a tap, the measurement made
as the action ended still saw SwiftUI's previous layout; the controller's
size report 1 to 2 ms later measured the new width, which was mounted.

The hosting screen (`--entry hosting.js`) ran on the iOS simulator in
both example apps (the Expo one prebuilt with the Lucent plugin, its
component's Swift built in the Lucent pod), Release and Debug:

- A full-screen modal covering the screen made its toggles' SwiftUI
  `onDisappear` run, and closing it their `onAppear`: their controllers
  appear and disappear with the screen. The modal's own toggle appeared
  in it and took commands.
- A page sheet kept its size while its toggle's title grew and the host
  measured it again.
- A toggle laid out right to left drew its knob from the right, and with
  the device's appearance dark, SwiftUI's text turned light.
- After the app went to the background and came back, a toggle kept its
  state and took commands. Remounted toggles started from their initial
  state.
- With the text size the user chose larger, the toggles' SwiftUI text
  grew and the hosts measured it: 56.3 pt high, then 61.3.
- A Debug build reloaded JavaScript with toggles mounted: the new
  runtime's toggles mounted afresh and took commands, and the teardown
  reported no platform object held.

Limitations of SwiftUI content:

- A body's callbacks only call the setup's functions.
- `ForEach` in a body is Lucent's keyed list: the generated declarations
  end with its form, which merges into SwiftUI's `ForEach`.
- SwiftUI members a body can't write yet are left out of the
  declarations or fail with LUCENT3024 and the reason, which names what
  it refuses: those that take a `Binding` of anything but a Bool, a
  String, a number or a type any of them may be (a `Binding of Color`),
  builders given values (`ForEach`, `GeometryReader`), closures that
  return a value to SwiftUI (left out where they have a default),
  generic constraints the call form can't write
  (`F: ParseableFormatStyle`), and members newer than iOS 15.1 (a body
  has no availability checks yet). A static value named like a method of its
  type (`Animation.easeInOut`) is left to the method
  (`Animation.easeInOut({ duration: 0.3 })`).
- A `withAnimation` called while effects wait (inside an effect, or a
  transaction) does not animate: its writes' effects run after it.
- Before iOS 16.4, SwiftUI gives the body the safe area insets of the
  screen's edges it overlaps, so a body at an edge may measure taller
  than its content.

## Compose content

An Android component draws with Jetpack Compose by returning
`compose(() => …)` from `lucent:compose`. The body is compiled to a Kotlin
composable, in the same call form as SwiftUI's: a composable takes
Kotlin's named arguments as one object literal, and its trailing
`@Composable` content lambda is a function returning an array of what it
shows. Statements such as `remember`, `animate*AsState` and
`LaunchedEffect` go in the body, or in a content lambda, where they
compose.

```tsx
export function Toggle(props: Props): ComposeView {
  const on = signal(false);
  const flip = () => {
    on.set(!on.peek());
    props.onChange?.(on.peek());
  };

  return compose(() => {
    const x = animateDpAsState(on.get() ? dp(20) : dp(0), spring());

    return Box({ modifier: Modifier.size(dp(52), dp(32)).clickable(() => flip()) }, () => [
      Box({ modifier: Modifier.offset({ x: x.value }).size(dp(26)) }),
    ]);
  });
}
```

- **Compose as it is.** `lucent:compose` declares the Compose release
  Lucent builds with (material3 too, which the Android library depends
  on when content uses it), from its Kotlin metadata, by rules: a composable
  showing UI takes its named arguments as one object and its content
  last, and returns `Composed`; other functions (composables giving a
  value, effects, factories) take Kotlin's parameters in order, the
  defaulted ones optional, or in one options object when they all have
  defaults (`spring({ stiffness })`) or come before one without
  (`clickable(onClick, { enabled })`). A class's extensions are its
  methods (`Modifier.padding(…)`), its companion's members its statics
  (`Color.White`), its constructors functions of its name (`Dp(20)`); an
  extension property of a number is a function of it (`dp(20)`).
  Kotlin's Float, Int and Long stay what they are through generics
  (`State<Float>`), and a suspend function returns a promise. What
  content cannot call yet is left out: members of a lambda's receiver
  scope (RowScope's `weight`), experimental APIs, reified type
  parameters, callbacks taking arguments.
- **Scopes.** A lambda Compose runs in a receiver scope (a Row's
  RowScope, a LazyColumn's LazyListScope, a list item's LazyItemScope)
  gets the scope as its first parameter, which may be left out:
  `Row({}, (row) => […])`. The scope's extensions are its methods
  (`column.AnimatedVisibility(…)`, `list.items(…)`), and its member
  extensions of Modifier start from its `Modifier`
  (`row.Modifier.weight(1)`); Modifier's extensions give back the
  modifier they are called on, so a chain keeps the scope's. The Kotlin
  is the lambda with its receiver: the scope's calls and its Modifier are
  written unqualified.
- **What is Kotlin.** Compose's calls, modifier chains, animations and
  effects, and what the body computes from them (`remember`ed objects,
  layout), are Kotlin. A value slot is Compose state in a generated
  holder, which the slot's effect sets; the body may keep an object it
  reads in a `const` and read its fields (`s.label`). A callback is a
  Kotlin lambda
  calling the setup's functions, each a Kotlin function object entering
  the main context. `cond && A(…)` and `cond ? A(…) : B(…)` in content
  are Kotlin's `if`; `AnimatedVisibility` animates content in and out,
  and animations take values the setup computes (`spring({ stiffness:
stiffness.get() })`) as any argument does. A composable called anywhere but in content (where
  what it shows would be lost), and JSX, are refused.
- **The composition.** The runtime's `LucentComposition` hosts every
  body: the generated host object only gives it the body's composable.
  It makes the ComposeView with the context of the shell the component
  mounts in (React Native's themed context over the Activity), so the
  body sees the Activity's theme and configuration. The composition
  starts when the view first attaches. It takes its lifecycle, saved
  state and view model store owners from the view tree. A window whose
  tree lacks one (a plain dialog's, an overlay's) gets the Activity's,
  set on the window's root, and content with no lifecycle or saved state
  owner anywhere fails with an error naming it. A detach keeps the
  composition (React Native detaches views it clips, moves or pools).
  The mount's end (unmount, recycle, a reload) disposes it, and so does
  the destruction of the view tree's lifecycle
  (`DisposeOnViewTreeLifecycleDestroyed`), for a host that ends a window
  without dropping its views. A mount that ends before its view is ever
  attached never composes. Its end also takes the composition's views out
  of the ComposeView, and the body with them: a disposed composition
  keeps its layout nodes, whose modifiers hold the body's callbacks, the
  holder's actions and the setup's functions, whose captures may hold
  the view itself by a JNI global reference, a cycle the garbage
  collector cannot see.
- **State.** The body reads each value slot from the holder where it
  uses it, so a composition never keeps a value of an earlier commit.
  `remember` and `rememberSaveable` last as long as the mount: each
  composition has a saveable state registry of its own, which restores
  nothing another mount saved. (Compose's own registry keys every
  ComposeView without an id alike, so a new mount could get another's
  state.) A configuration change React Native's templates handle
  themselves (the dark theme) keeps each mount and its
  composition, which recomposes with the new configuration. One they
  don't handle (the font scale) recreates the Activity: React Native
  starts its surface again, so every component mounts anew, its setup
  runs again and its body starts from its initial state, as React's own
  state does.
- **Drawing outside.** The shell doesn't clip its content, as React
  Native doesn't clip a view's children by default and the iOS host
  doesn't: a body scaled beyond its box (the toggle's pulse) draws whole.
  A body that must stay inside clips itself, with Compose's own
  modifiers (`clipToBounds()`, `clip(shape)`).
- **Sizing.** The content is laid out at its own size inside the view.
  When that size changes, the view asks for a layout, and the host
  measures it again (a new content revision). A ComposeView cannot
  measure before it is in a window (it composes with the window's
  recomposer), so the shell measures no content before then: its first
  layout in the window does (the relayout backstop).

The same screen ran on the Android emulator, with view recycling on,
through three launches: commands, a pulse from a coroutine of the
composition, a new title (the host measured 64 → 73 wide), clicks
(events heard 6 to 9 ms later), and the timer's flips during the 3 s
block, animated on time. A remount entered its composition in the
recycled host. While JavaScript was blocked, the "on" row appeared but
the component kept its height until JavaScript ran again: sizes wait for
the JavaScript thread (see Sizing). It ran the same in the Expo example,
whose release build shrinks its code, and the pulse drew beyond the
toggle's box in both.

The views spike's lifecycle screen (`--entry lifecycle.js`) ran in both
example apps on the emulator, with recycling on. Navigation mounted and
ended four toggles six times, a Modal showed one in its own window and
closed, the dark theme turned on, then the font scale changed. Every
mount entered its composition, and each of the 26 that ended left it
and was disposed. The dark theme recomposed the toggle that stayed
(its text said "dark", its mount unchanged), and the font scale
recreated the Activity: the toggle mounted again, and its saveable
state held the new mount, not the old one. A heap dump after garbage
collection then held one state holder, one ComposeView and four function
proxies: the live mount's.

## Accepted limitations

- Android pools component views only when the app turns React Native's
  `enableViewRecycling` on. iOS always recycles them.
- A burst of commits in one JavaScript task: iOS merges the commits
  (React Native accumulates props) and applies the last one. Android
  mounts each commit, unless the app turns
  `enableAccumulatedUpdatesInRawPropsAndroid` on, and then it merges
  them too. Either way, the host applies the final props. Its effects
  run once per mounted commit.
- A discrete or continuous event is never dropped: while JavaScript is
  busy they queue, and enough of them can hold React's renders back. An
  event whose latest value is all that counts should be `Coalesced`.
- With two React Native runtimes alive at once, answers go to the
  runtime that connected last.
- Setup, effects and commands run on the main thread. Long work there
  stalls the UI; compute tasks are where it belongs.

## Sizing

A component whose style gives it a size of its own (explicit, or given
by flex) fills it. One without is sized by its content.

**Filling a size.** The view setup returns is laid out in the host's
content box: its frame less border and padding, at every layout. On iOS
it is the host's content view, which React Native frames to the
layout's content frame. On Android the manager hands Yoga's border and
padding to the shell as its own padding, and the shell lays its single
child out inside them. Yoga never asks a component with both axes fixed
to measure itself.

**Sizing by content.** The runtime keeps the logic in a plain core,
`lucent/sizing.h`, which `rn/LucentViewSizing.h` adapts to the renderer.
Each component's shadow node (`HostShadowNode`) is a measurable Yoga
leaf. Its Fabric state holds the constraints its layout asked for and
the latest measurement.

1. When Yoga measures the node (a renderer thread), the node records
   the bounds (the largest width and height) and returns the size its
   state holds. That is zero before the first measurement, and the
   previous one while the host measures under new constraints. It never
   waits and never calls UI code.
2. The node's layout completes the bounds with its font scale and
   layout direction. Unless the measurement its state holds answers
   those constraints (below), or its state asks for them already, the
   layout records them in its state. The request reaches the host with
   the commit.
3. On the main thread, the host measures its content when the state asks
   for constraints that the content's current revision was not measured
   under:
   - The revision is 1 at mount and goes up each time the mount's code
     has run. The host enters the mount (`lucent/view.h`'s `Content`) to
     set it up and to hand it each commit and command, and every
     function the setup made enters it whenever it runs (a native
     callback or timer, an effect). The host counts one change when the
     outermost entry on the main thread ends. Code after an `await` runs
     in none of them: it calls `invalidateSize()` from `lucent:ui` to
     have the view measured. On Android the revision also goes up when
     the content asks the shell for a layout, a backstop for a change no
     Lucent code made. On iOS it also goes up on the turn after the text
     size the user chose changes: React Native records the new font
     scale but lays nothing out for it, so content that follows Dynamic
     Type would otherwise keep its old size.
   - iOS measures with `sizeThatFits:`.
   - Android measures with `View.measure` at most the constraints, in
     density-independent pixels, after `forceLayout()` on the content
     and every view inside it: a view keeps the size it measured under
     the same constraints, and would give it back after a change.
   - Sizes are snapped up to the physical pixel grid.
4. The host posts the measurement (size, constraints, revision) as a
   state update and does not wait for it. Until the renderer has judged
   it, a new measurement of the same size under the same constraints is
   not posted. The renderer applies the
   update on the JavaScript thread. It keeps the measurement only if it
   answers the constraints the state asks for now, its revision is not
   older than the one held, and the size differs by more than one
   physical pixel. Otherwise the update is dropped.
5. An accepted measurement marks the node for layout again, and Yoga
   lays it out at the new size. Sizing has converged when the state
   holds a measurement that answers the constraints it asks for.

A measurement answers the constraints it was made under, and stricter
bounds that its size still fits within: the content's measure is taken
to be monotonic, as Yoga's own measure cache takes it. It never answers
a looser bound, which may have cut the content (wrapped its text), nor
another font scale or direction. So a column's remaining height
shrinking as siblings are added measures nothing again.

A host posts at most three measurements that do not settle its state
(the constraints keep changing with the size) until its content changes.
After that it stops, and logs it, so a size and its constraints cannot
chase each other forever.

Limitations of sizing by content:

- A component shows its previous size, zero at mount, for at least one
  layout after each change.
- The new size waits for the JavaScript thread, which applies state
  updates. While JavaScript is blocked, the native content changes but
  its size does not. Committing the update from the main thread instead
  (`unstable_Immediate`) settled such a change in 18 ms during a 500 ms
  block, but runs the tree's layout on the main thread: up to 20 ms per
  update on an Android emulator (0.6 ms on the iOS simulator) for the
  spike's small tree. It is not used.
- A change of the native content that no code of the mount makes (the
  platform loading an image by itself, or code after an `await` that
  does not call `invalidateSize()`) keeps the old size on iOS, and on
  Android when it requests no layout.
- A looser bound than the one measured under (a column's remaining
  height growing) measures the content again.
- Locale is not an input of a measurement (font scale and direction
  are).
- The Android shell does not draw React Native borders; their width
  still insets the content.

### Sizing, measured

The spike's sizing screen (`scripts/views-spike.ts --entry sizing.js
--trace-sizing --font-scale`) ran on the iOS simulator (3 pixels per
point) and the Android emulator (2.75 pixels per dp, font scale 1.3). It
mounts components sized by their content, grows and shrinks their text,
narrows and widens their column, changes their text natively (a command,
and a native timer while JavaScript is blocked for 500 ms), loads images
after an await (one calling `invalidateSize()`), turns the column right
to left, unmounts a component while its result waits for JavaScript and
mounts another, and, on iOS, changes the text size live.

- Every change settled with one accepted result: one state commit, with
  one layout at the old size before it. No host reached the bound on
  unsettled results.
- Mount: the first frame is zero-sized; the measured size was on screen
  30 ms later on the simulator and 52 ms on the emulator at app start,
  2 ms and 17 ms for a later mount.
- A change while JavaScript runs freely: the measured size was mounted
  1 to 5 ms after the measurement on the simulator, 15 to 23 ms on the
  emulator. With JavaScript blocked, it waited for the block's end
  (about 350 ms of a 500 ms block on both).
- Column height changing as lines were added below: no measurement
  (the spike's column shrank about 100 points).
- A live text size change on iOS: each host measured once on the next
  turn, then once more under the new font scale its layout asked for:
  two results, 5 ms apart.
- The image loaded after an await without `invalidateSize()` stayed
  zero-sized on iOS (until the text size change measured it); on
  Android the shell's relayout measured it.
- A result posted just before its component was unmounted was never
  applied, and the next component on the recycled view (iOS) started
  from its own first measurement.
- Android measures again when the content asks for a layout after a
  commit: that second result, the same size, is judged unchanged
  (JavaScript thread work, no commit).

## Children

A component takes React children when its props declare
`children?: Children` (or `children: Children`), `Children` coming from
`lucent:ui`. Its setup then makes the view they are mounted in, its slot,
once, in a `const` at its top level, and puts it in the view it returns:

```tsx
export function Card(props: { title: string; children?: Children }): UIView {
  const card = native(() => new UIView({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } }));
  const content = slot<UIView>();

  card.addSubview(content);

  return card;
}
```

`slot<T>()` names the platform's container class, UIKit's `UIView` or
Android's `ViewGroup`, and the compiler refuses any other. It also
refuses children without a slot, a slot without children, a second slot,
a slot made anywhere but a top-level `const` of setup, and setup reading
`props.children`. React's declarations take `children?: ReactNode`, and
the runtime renders the native view with them.

**Who owns what.**

- React Native owns each child. It creates, updates and destroys it,
  sets its frame (Yoga's, in the component's coordinates), and says where
  it goes: mounted or unmounted at an index of the component's children.
- The host owns the slot and the children's place in it. It makes a new
  slot for each mount, keeps the children in React Native's order, puts
  each one in the slot below the next child already there, and takes it
  out only when React Native unmounts it. Children mounted before the
  view's first commit, which React Native mounts first, go in when the
  mount starts. Nothing else moves or removes them.
- The setup owns the slot's place: its ancestors, its z-order among its
  siblings and its frame. The slot fills the view it is added to unless
  setup sizes it, and a native layout container may lay it out: the
  native layout owns the slot's frame, never a child's.

**Layout.** A component taking children is a Yoga container
(`SlotShadowNode`), sized by its style, flex and children as a View is.
Its host never measures its content. A component without children stays
a leaf sized by its content (see Sizing): one component is one or the
other.

**Where the children lay out.** Yoga lays the children out in the
slot's rectangle, which only the host can measure. The runtime keeps the
logic in a plain core, `lucent/slots.h`, which `rn/LucentViewSlots.h`
adapts to the renderer. The host reports the slot's place to the
component's Fabric state, as it posts content measurements (see
Sizing):

1. On the main thread, the host measures how far the slot lies in from
   each edge of the component's content box (the one Yoga laid the
   component out with), snapped to the nearest physical pixel, and
   notes the layout direction.
2. It posts that as a state update when the state lacks it, once while
   it is pending, and does not wait. On iOS it measures each time the
   slot has laid itself out: after the mount, after each applied commit
   and command, when the host lays out, and when the slot moves or
   resizes. On Android the slot passes its place on at each of its
   layouts and before each frame, when it or the content box changed.
3. The renderer applies the update on the JavaScript thread. It keeps
   the report only if it is not older than the one the state holds and
   moves an edge by at least a physical pixel (or changes the
   direction of non-zero insets). Otherwise the update is dropped.
4. With a report in its state, the shadow node lays its children out as
   if the component's border were wider by the insets.

So a child with `flex: 1` fills the slot, and a component sized by its
children grows by the room its native views take around the slot (a
header above it, for one). An absolutely positioned child is placed from
the slot as a View's child is from its padding box: the slot, extended by
the component's own padding when its style sets one. The layout metrics
the host receives keep the style's own border and padding, so the
setup's view stays in the real content box and never moves with the
slot.

Before the first report the children lay out in the content box. A slot
that fills the view it is added to, the default, is there already: its
host posts nothing and the children never shift. A slot elsewhere shows
its children at the content box for at least one layout, until the
JavaScript thread applies the report, as a content measurement waits
for it.

A host posts at most three reports that do not settle the state (a slot
whose place follows the component's size, such as a fixed slot in a
component sized by its children) until the mount's native views change.
After that it stops, so the slot and the component's size cannot chase
each other forever.

**Placement.** The slot never lays its children out. Their frames stay
in the component's coordinates, where React Native measures them
(`onLayout`, `measure`), even when Yoga lays them out in the slot. The
slot shows them in those coordinates wherever it is, so a child shows at
the frame Yoga gave it. On iOS the slot's bounds' origin is its own
origin in the host, realigned when the slot moves or resizes, when the
host lays out, and after each commit and command the mount applies
(UIKit tells a view nothing when an ancestor moves without resizing it);
each realignment is when the host measures the slot's place. On
Android the slot scrolls its content by that origin at each layout and
before each frame. On iOS a native view moved by native code alone (an
animation, a timer) takes the slot along only at the component's next
layout.

Because the children are laid out in the component's coordinates, the
slot works under any native view that shows it: a view setup made, or,
later, a native host of declarative content, as long as the slot is a
descendant of the component's host view.

**Clipping and touches.** The slot clips its children to its bounds on
both platforms, so a child shows, and receives touches, where it falls
inside the slot. Native ancestors clip as they do natively: Android view
groups clip their children by default, UIKit views do not. A touch
reaches a child only through the native views that contain the slot:
UIKit and Android deliver touches within a view's bounds.

**Accessibility.** The children keep their own accessibility. A native
view between the host and the slot that is itself an accessibility
element (a `UIButton`, a clickable Android view) hides them or merges
them into itself, as the platform does for any subview.

**Teardown and recycling.** React Native unmounts a view's children
before it recycles or drops the view. The mount's slot goes with its
mount, and the next mount of a recycled view gets a new one. A view
recycled while still holding children is reported, and they stay where
React Native left them.

**Android.** React Native mounts children only through a manager that
is an `IViewGroupManager`. Each component's manager is one: it hands
each addition and removal to the shell, whose rules (`LucentChildren`,
plain Java) are the iOS host's. `getChildAt` and `getChildCount` report
React Native's own list, and `needsCustomLayoutForChildren` is false, so
React Native lays the children out.

**Reported, not supported.**

- Children given to a component taking none: the runtime renders none
  and says so once, and a host given some anyway reports them and shows
  none.
- A slot setup leaves out of its view: reported at mount.
- Containers whose children must be the React children themselves (a
  stack view arranging each child, a collection view's cells, a page
  controller's pages) need an adapter a package authors; none exists
  yet.
- A slot inside a native scroll view keeps its children where Yoga put
  them in the component, so they do not scroll: put a React
  `ScrollView` in the slot instead.
- Transforms on the native views between the host and the slot are not
  part of the placement: a scaled ancestor scales the children, which
  Yoga's frames do not account for.
- React Native's `removeClippedSubviews` does not apply to a Lucent
  component's children.

**Measured.** On the iOS simulator and the Android emulator, the slots
screen of the views spike (`scripts/views-spike.ts --entry slots.js`)
checks, after each step, that the slot holds React Native's children in
its order at Yoga's frames: mounted, updated, reordered, removed, a Text
added, the native view holding the slot moved, the card's padding
changed, a Modal child (a portal) shown and closed, and the card mounted
again. A touch inside a child reaches it (iOS: UIKit's hit test from the
host; Android: a real tap). It also runs a windowed list of cards,
whose cells unmount and mount again as it scrolls, and a windowed list
of rows inside a card. React Native may mount a child's own children in
the card as well (a view that forms no stacking context has its
children mounted in the nearest one that does): they are the card's
children, and go in its slot like any other.
