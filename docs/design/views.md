# Views: Lucent components in React Native's renderer

Status: implemented, in preview. Every compile generates what follows for
the components its modules export, an app's or a package's; a program
without components gets none of it.

A component is an exported function of a `.lucent.tsx` module that
returns a platform view (a `UIView` or an Android `View`). Its setup is
compiled to C++, runs on the main thread once per mount, and returns the
view React Native shows. JavaScript sees a React component with the
component's props, its events as callback props, and a ref whose methods
are the commands setup exposes: a void command runs, and a request answers
a promise. [architecture.md](../architecture.md) describes how the
compiler generates each piece. This record covers what the platform hosts
do with them at run time.

The app imports a component as `lucent:views/<module>`
(`import { Card } from "lucent:views/card"`). TypeScript reads the React
declarations `lucent build` writes to `types/views/<module>.d.ts` through
the app's `lucent:*` tsconfig path; Metro resolves the name to a
generated module that requires the component's own, so it and a relative
`./card.lucent` import are one module and register the view once.
TypeScript resolves the relative import to the `.lucent.ts` source, whose
types are the platform's, not React's, and no file or path can change
that, so only the `lucent:views` name gives the React types.

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
  child. Setup makes the native objects it shows and owns directly
  (`const label = new UILabel()`): they go with the mount, when the host
  destroys it. Android waits for the attach because React Native can create
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

Module state is the module's thread's, so setup code cannot use it
(LUCENT3022), except state only main-thread code uses: components and
`main()` callbacks (contracts.md, `mainState()`). Every use of that runs
on the one main thread, so it needs no lock. It holds plain values or
native objects, through a collection's members only, so no reference to
it reaches the module's thread; `init()` assigns it on the main thread,
so a reload does not race a view still mounted. This is how a class
JavaScript makes shares a native object with a view: expo-video's
`VideoPlayer` keeps its `AVPlayer` in such a map, under the id the view
takes as a prop, as Expo's own view does.

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
Compose on Android (`lucent:compose`). `lucent:swiftui` declares SwiftUI as the SDK
declares it; `lucent:compose` Compose as its Kotlin metadata declares
it. A component returns its body: JSX of its toolkit's views, once, as
the last statement of its setup (of its platform's code, in a one-file
component). Its root, the object the host shows, is
the toolkit's: the `UIHostingController` Lucent makes for an iOS body,
the `ComposeView` it makes for an Android one. The body is written out
in the toolkit's language, with, on Android, the setup's statements that
compose (see Compose content); the rest of the setup is Lucent code, as
in any component (signals, effects, commands, timers, events). The component's module is
a `.lucent.tsx` file, as every component's is.

**One file for both platforms.** A component is written in one shared
`.lucent.tsx` file: its logic once, and its body with each platform's
toolkit, in that platform's code:

```tsx
// like.lucent.tsx
import { PLATFORM } from "lucent:platform";
import { Animation, Color, Font, HStack, Image, Text } from "lucent:swiftui";
import {
  Alignment,
  animateFloatAsState,
  Color as CColor,
  Modifier,
  Row,
  spring,
  Spring,
  Text as CText,
} from "lucent:compose";
import { signal } from "lucent:ui";

export function Like(props: { count: number }) {
  const liked = signal(false);
  const toggle = () => liked.set(!liked.get());
  const count = () => props.count + (liked.get() ? 1 : 0);

  if (PLATFORM === "ios") {
    return (
      <HStack spacing={6} onTapGesture={toggle}>
        <Image
          systemName={liked.get() ? "heart.fill" : "heart"}
          scaleEffect={liked.get() ? 1.3 : 1}
        />
        <Text font={Font.headline}>{`${count()}`}</Text>
      </HStack>
    );
  }

  const pop = animateFloatAsState(
    liked.get() ? 1.3 : 1,
    spring({ dampingRatio: Spring.DampingRatioHighBouncy }),
  );
  return (
    <Row verticalAlignment={Alignment.CenterVertically} modifier={Modifier.clickable(toggle)}>
      <CText text={liked.get() ? "♥" : "♡"} modifier={Modifier.scale(pop.value)} />
      <CText text={`${count()}`} />
    </Row>
  );
}
```

Each toolkit's names are imported by name, aliased where the two clash
(`Text as CText`). A toolkit's code is its platform's: a SwiftUI name
stands in iOS code, a Compose name in Android code, as the platform SDKs'
names do. Platform code is a `PLATFORM` branch (`if (PLATFORM === "ios")`,
its `else`, a ternary), the code after a guard that returns
(`if (PLATFORM === "ios") return …`), or a top-level declaration using
one platform's code (a helper view). A toolkit's name anywhere else fails
with LUCENT3024 naming its platform. Each platform's program compiles
the setup with its own code: the setup's logic, shared, is compiled for
both, and the body is the one return of the platform's toolkit JSX its
code has, standing in the setup's own code or in its platform branches.
A component returning a body on one platform only fails with LUCENT3023,
as a component on some platforms only does. On Android, the statements
of the Android code that compose are its composition statements (see
Compose content), whether they follow an iOS guard or stand in an
Android branch.

The views spike's toggle and list screens are one-file components. Built
in Release, they ran on the iOS simulator and on the Android emulator
(view recycling on), each platform's program compiling its own code of
the same file: on iOS the toggle took commands, pulsed with
withAnimation, measured a new title and flipped on its timer while
JavaScript was blocked, and the list took its commands and its slider;
on Android the toggle's composition statements (its spring, its pulse's
coroutine, its lifecycle effect) composed from the Android code, and
real taps toggled and removed the list's items and added the field's
text.

Split files stay supported: a module may be a shared declaration
(`like.lucent.ts`) and a file per platform (`like.ios.lucent.tsx`,
`like.android.lucent.tsx`), each writing its own toolkit.

**Typing.** A platform file's JSX is its toolkit's: the JSX of a
`*.ios.lucent.tsx` file is typed by `lucent:swiftui`, that of a
`*.android.lucent.tsx` file by `lucent:compose`. A shared `.lucent.tsx`
file's JSX is typed by both: its JSX runtime is `lucent:jsx`, whose
element is every toolkit's at once (`View & Composed`) and whose tags are
either toolkit's views, so each element checks against its own
toolkit's declaration, and a SwiftUI modifier may chain after an element
(`(<Text>a</Text>).padding(4)`). Where a platform's SDK is missing, its
toolkit is left out and its code is untyped, as its SDK's is. A setup
returns the view its target's own code returns (`emit/setups.ts`) where
the function's return type mixes platforms: each platform's view at
once, or `any` where the other's SDK is missing. The compiler and
editors (through the Lucent TypeScript plugin, and the
`lucent:jsx` declarations `lucent build` writes beside the others) type
them alike; the app's own `.tsx` files keep React's.

The body and its setup meet through slots, the same way on both
platforms (`ui/toolkit-body.ts`, `emit/toolkit.ts`):

- Plain data the body reads from the setup (`on.get()`, `props.title`, a
  template of them, what a setup function returns, an object, an array)
  is a value slot. The largest such expression is one slot, computed by
  the setup's C++ with JavaScript's semantics (a function of the setup's,
  through the IR, which the slot's effect calls). An effect of the mount
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
  SwiftUI's `<ForEach data={items} id={(item) => item.id}>{(item) => …}</ForEach>`,
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
  (`<TextField text={bind(draft)}>New</TextField>`,
  `<Toggle isOn={bind(done)}>Done</Toggle>`), or Compose's value and its
  change callback, where a
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

**Helper views.** A body may split its views into helpers: functions of
the same platform file, at its top level or in the setup, not exported
(an exported one is a component), returning the toolkit's JSX. The body
uses one as an element, `<Row title={t.title} onToggle={() => toggle(t)} />`,
or calls it in its content, `{Row({ … })}`; helpers may use helpers.
Lucent writes each once per component in the toolkit's language (a
Swift `View` struct, a Kotlin `@Composable` function), never as C++
(`ui/view-helpers.ts`):

- A helper takes one props object, read where it is used as
  `props.name`. Its props are plain data and callbacks taking numbers,
  booleans and strings and returning nothing.
- What a helper computes from its props (the largest expression reading
  them, as a body's values are) is a value of its own, which the setup
  computes where the helper is used, as JavaScript would call it: its
  props read what the element gives them, each once, in order. Used in
  the body, a helper's values are the body's; in a list's item, the
  item's. A helper using another gives it its own values.
- A helper's callbacks call its callback props, or give them on, with
  its values, literals and the callback's parameters. What its user gives
  a callback prop follows the body's rules (a setup function, or `() =>`
  calling them, a list's item crossing as its key).
- A helper reads nothing of its setup's but its props (a setup's helper
  may use its other helpers), and doesn't use itself. A helper destructuring
  its props or taking several, taking a toolkit's value (a `Color`), or
  showing a list or binding a signal, fails with LUCENT3024: its user
  does those.

The views spike's list screen (`scripts/views-spike.ts --entry list.js`)
ran on the iOS simulator and on the Android emulator (view recycling on),
a todo list in one file: its logic once, its body with each toolkit. Commands added todos (each
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
Each list's item is a helper view (`TodoRow`): on both platforms, real
taps on an item's mark and on its remove button reached the setup
through the helper's callback props, toggling the item by its key and
removing it by its id, and the helper's values followed each item.

## SwiftUI content

An iOS component draws with SwiftUI by returning JSX of SwiftUI's views,
with no wrapper:

```tsx
export function Toggle(props: { title: string }) {
  const on = signal(false);
  const flip = () => on.set(!on.get());

  return (
    <VStack spacing={8}>
      <ZStack
        alignment={on.get() ? Alignment.trailing : Alignment.leading}
        animation={[Animation.spring({ duration: 0.3 }), { value: on.get() }]}
        onTapGesture={flip}
      >
        <Capsule fill={on.get() ? Color.green : Color.gray} frame={{ width: 52, height: 32 }} />
        <Circle fill={Color.white} padding={3} />
      </ZStack>
      <Text>{`${props.title}: ${on.get() ? "on" : "off"}`}</Text>
    </VStack>
  );
}
```

Written as a split module, this is the component's iOS file
(`toggle.ios.lucent.tsx`), whose JSX is SwiftUI's, and the shared
declaration says the component returns SwiftUI's `View`
(`View | ComposeView` where Android draws with Compose); in one file, the
body stands in the iOS code (see Toolkit bodies). The body is one view,
returned once as the last statement of the platform's code: its
conditions are written in it.

**Elements.** An element is a view's initializer, called by its Swift
type's name. An attribute named like one of the initializer's labels is
that argument (`<Image systemName="star" />`, `<ZStack
alignment={…}>`); an unlabeled argument is named after its Swift
parameter (`<Picker titleKey="Size" …>`), and a trailing action after
its label (`<Button action={add}>`), or its parameter where it has none.
The children are the trailing `@ViewBuilder`'s content, or else the
first unlabeled string: `<Text>hi</Text>`, `<Text>{title()}</Text>`,
`<Button action={add}>Add</Button>`. Text children are one string; write
a template in braces to join values. Content given elsewhere (a
`Slider`'s `label={<Text>Level</Text>}`) is a closure too, wherever Swift
takes it. `lucent:swiftui` declares one JSX form for each of the
initializer's call forms.

**Modifiers.** Every other attribute is a modifier, applied in the order
written, after the initializer. Its value is the modifier's arguments,
as the call form gives them: one value (`padding={8}`,
`fill={Color.green}`), an object of its labeled ones (`frame={{ width:
52 }}`), or a tuple of both (`animation={[Animation.spring(), { value:
on.get() }]}`, `padding={[Edge.Set.horizontal, 16]}`), and the attribute
alone for none (`padding`). Trailing optional arguments may be left out:
`background={Color.red}`. Where a modifier's value could be a tuple or
one array, it is the tuple. Each modifier applies to what the ones before
it made, so one a view no longer has (a `Shape`'s `stroke` after `fill`)
is refused. JSX writes an attribute once: a modifier given again chains
after the element, as a method, with the call form's arguments:
`(<Text padding={8} background={Color.red}>a</Text>).padding(4)`. A
modifier of a type parameter takes each scalar's form
(`onChange={[{ of: level.get() }, (now: number) => leveled(now)]}`): its
callback names its parameter's type. A name that is both an argument of
the view's initializer and a modifier (`Color`'s `opacity`,
`RoundedRectangle`'s `cornerRadius`) is the argument, as any attribute
named like a label is: `<RoundedRectangle cornerRadius={8} />`. The
modifier of that name chains after the element:
`(<Color red={1} green={0} blue={0} opacity={0.5} />).opacity(0.8)`.

SwiftUI's values are calls in the call form: Swift's unlabeled arguments
in order, its labeled ones as one object literal, a closure last
(`Animation.spring({ response: 0.3 })`, `Color.blue.opacity(0.15)`,
`Angle.degrees(angle.get())`). A view given as a value (`clipShape`'s
shape) is one too: `Circle()`. In content, views are JSX.

A helper view is a `fileprivate` Swift `View` of the component's file,
`<Component>View_<Name>`: a `let` property per value it computes and per
callback (`let onToggle: () -> Void`), and an `@Environment` property
per environment value it reads. Its user writes it with them:
`TodosView_Row(done0: item.done7, …, onToggle: { actions(2, [item.id]) })`.

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
<Slider value={bind(level)} in={range(0, 1)} step={0.1} />
<Stepper value={bind(count)} in={range(1, props.max)}>Count</Stepper>
```

**Values of any scalar type.** A value of a type parameter that any
Lucent number, string or boolean fits (SwiftUI's `V: Equatable`,
`SelectionValue: Hashable`) is a TypeScript type parameter too, one per
Swift one: `onChange` gives its callback a number where it watches one,
and a `Picker`'s selection binds a signal of any of them
(`<Picker titleKey="Size" selection={bind(size)}><Text tag="s">S</Text></Picker>`).
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
content is SwiftUI's `if`: `{shown.get() && <Text>a</Text>}`, or a
ternary, whose branch may be `null` (content takes `false`, `null` and
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
- A SwiftUI helper view returns its JSX as its only statement: it
  computes its values in the JSX.
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

An Android component draws with Jetpack Compose by returning JSX of
`lucent:compose`'s elements, with no wrapper. The component's root view
is a ComposeView. The JSX is compiled to a Kotlin composable: a
composable showing UI is an element, whose props are Kotlin's named
arguments and whose children are its trailing `@Composable` content
lambda. The component's statements that compose (`animate*AsState`,
`remember`, `LaunchedEffect`) are lifted into that composable. The rest
of its code is its setup, as in any component.

```tsx
// toggle.android.lucent.tsx
import { Box, Modifier, animateDpAsState, spring, dp } from "lucent:compose";
import { signal } from "lucent:ui";

export function Toggle(props: { title: string }) {
  const on = signal(false);
  const flip = () => on.set(!on.get());
  const x = animateDpAsState(on.get() ? dp(20) : dp(0), spring());

  return (
    <Box modifier={Modifier.size(dp(52), dp(32)).clickable(flip)}>
      <Box modifier={Modifier.offset({ x: x.value }).size(dp(26))} />
    </Box>
  );
}
```

- **Composition statements.** A statement of the component's own code
  composes when it calls a composable or reads a composable property
  (`remember(…)`, `rememberSaveable(…)`, `animateDpAsState(…)`,
  `LaunchedEffect(…)`, `DisposableEffect(…)`, `isSystemInDarkTheme()`,
  `LocalDensity.current`), as Compose's bindings say. Such statements
  run in the content, in their order, before what the JSX shows, each
  time the content composes. The setup runs once, before the content
  first composes, so the rules follow from when each runs:
  - a composition statement stands in the component's own code, never
    in an `if`, a loop or a block, as Compose calls composables the same
    way at every composition; a composable in a function of the setup
    (an effect, a handler) is refused too;
  - it may read the setup's values, which cross as the JSX's reads do
    (each a slot the setup keeps set), and the values of the
    composition statements before it; where it stands among the setup's
    statements changes nothing else;
  - setup code never reads a composition value (it has none when it
    runs): only the JSX and later composition statements do;
  - Compose's other values (`spring()`, `Color.Red`) are made in the JSX
    or in a composition statement, never by setup code.

  What breaks a rule fails with LUCENT3024.

- **Helper views.** A helper (see Toolkit bodies) is a Kotlin
  `@Composable` function of the component's file,
  `<registration>_<Name>`: a parameter per value it computes and per
  callback (`onToggle: () -> Unit`). Its statements before its JSX are
  composition statements (`const width = animateDpAsState(…)`), which
  compose where it does; it has no other statements. Its user calls it
  with named arguments: `done0 = lucent_item.done5.value`, and a
  callback's lambda.

- **Compose as it is.** `lucent:compose` declares the Compose release
  Lucent builds with (material3 too, which the Android library depends
  on when content uses it), from its Kotlin metadata, by rules: a
  composable showing UI is a function of its props (Kotlin's named
  arguments, and `children` for its trailing content), which JSX calls,
  returning `Composed`; other functions (composables giving a value,
  effects, factories) take Kotlin's parameters in order, the defaulted
  ones optional, or in one options object when they all have defaults
  (`spring({ stiffness })`) or come before one without
  (`clickable(onClick, { enabled })`). A class's extensions are its
  methods (`Modifier.padding(…)`), its companion's members its statics
  (`Color.White`), its constructors functions of its name (`Dp(20)`); an
  extension property of a number is a function of it (`dp(20)`).
  Kotlin's Float, Int and Long stay what they are through generics
  (`State<Float>`), and a suspend function returns a promise. What
  content cannot call yet is left out: experimental APIs, reified type
  parameters.
- **Elements.** Children are what the element shows, in order: elements,
  fragments (`<>…</>`), `cond && <A …/>` and `cond ? <A …/> : <B …/>`,
  which are Kotlin's `if`. A prop written alone (`singleLine`) is true. A
  content lambda given as a prop other than the children (Switch's
  `thumbContent`) is a function returning what it shows. Calling a
  composable that shows UI (`Box({ … })`), spreading props, and elements
  that are not Compose's are refused.
- **Scopes.** Content Compose runs in a receiver scope (a Row's
  RowScope, a Column's ColumnScope) may be given as a function of the
  scope, for children that use it:
  `<Row>{(row) => <Text modifier={row.Modifier.weight(1)} … />}</Row>`.
  The scope's extensions are its methods, and its composables elements
  (`<column.AnimatedVisibility visible={…}>`); its member extensions of
  Modifier start from its `Modifier` (`row.Modifier.weight(1)`), and
  Modifier's extensions give back the modifier they are called on, so a
  chain keeps the scope's. A lazy list's content is a function of its
  LazyListScope whose items are elements of it, the item content their
  children, a function of the item's scope and the item:
  `<LazyColumn>{(list) => <list.items items={todos.get()} key={(t) => t.id}>{(_, t) => …}</list.items>}</LazyColumn>`.
  The Kotlin is the lambda with its receiver: the scope's calls and its
  Modifier are written unqualified.
- **What is Kotlin.** Compose's calls, modifier chains, animations and
  effects, and what the content computes from them (`remember`ed
  objects, layout), are Kotlin. A value slot is Compose state in a
  generated holder, which the slot's effect sets; a content lambda may
  keep an object it reads in a `const` and read its fields (`s.label`),
  and an object crosses as a Kotlin data class (an effect keyed by it
  runs again only when it changes). A callback is a
  Kotlin lambda
  calling the setup's functions, each a Kotlin function object entering
  the main context. `AnimatedVisibility` animates content in and out,
  and animations take values the setup computes (`spring({ stiffness:
stiffness.get() })`) as any argument does.
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

## Platform views as JSX

A component can also return its platform's views as JSX: UIKit views on
iOS, Android views on Android. Nothing
about the views is listed in Lucent: what a tag takes comes from its
class's declarations, by rule (`packages/compiler/src/sdk/view-rules.ts`).

```tsx
// settings.ios.lucent.tsx
import { UILabel, UIStackView, UISwitch, type UIView } from "lucent:ios/UIKit";
import type { Props } from "./settings.lucent";

export function Settings(props: Props): UIView {
  return (
    <UIStackView spacing={8}>
      <UILabel text={props.title} numberOfLines={1n} />
      <UISwitch isOn={props.enabled} onValueChanged={(control) => props.onToggle?.(control.isOn)} />
    </UIStackView>
  );
}
```

```tsx
// settings.android.lucent.tsx
export function Settings(props: Props): View {
  return (
    <LinearLayout orientation={1}>
      <TextView text={props.title} />
      <CheckBox checked={props.enabled} onCheckedChange={(_box, on) => props.onToggle?.(on)} />
    </LinearLayout>
  );
}
```

**The rules.** Each view class gives its tag:

- **Props:** its writable properties (iOS, Kotlin), and on Android its
  one-value `set<X>` methods, overloads one prop (the value's type picks
  the overload). Methods, read-only, static and constant members are not
  props. A generic setter is left out: an attribute gives no type for it.
- **Events:** on Android, `setOn<X>Listener(L)` where `L` has one method
  gives `on<X>`, a function of that method's arguments; a listener of
  several methods (SeekBar's, TextWatcher) is left out, for setup code. On
  iOS, a class declaring `addAction:forControlEvents:` (UIControl's
  convention) gives `on<Case>` for each single-bit case of the events it
  takes (`onTouchUpInside`, `onValueChanged`); the handler gets the tag's
  own class (`(control: UISwitch) => …`).
- **Children:** a class that inserts views at an index takes children:
  on iOS the nearest `insert<X>:atIndex:` (a stack view's
  `insertArrangedSubview:atIndex:`, any view's `insertSubview:atIndex:`),
  on Android `addView(View, int)`. Any other class takes none. No adapter
  is written: the compiler knows the method's shape, never a class name.
- **Construction:** iOS `initWithFrame:` with a zero frame, else `init`,
  the class's own or inherited; Android the `(Context)` constructor, given
  the hosting view's context (`lucent::jni::viewContext`). Otherwise the
  element says how: `create={() => new MyChart(frame, options)}`, which
  any tag may give.

A subclass inherits its classes' attributes, the nearest class's
winning. The rules are pure functions of the schema; `lucent sdk
coverage --views` lists them per module, with `--members` each
attribute's rule and artifact.

**Typing.** Each view class's declaration gives what it adds under a key
of its own, `"~jsx:<module>.<class>"`, typed with the tag's class
(`this`), so a control's handler gets the subclass; the root view's
`"~jsx"` gathers every key of the hierarchy (lucent:ui's
`NativeAttributes<this>`), which `JSX.ElementAttributesProperty` reads.
Each attribute is documented with its rule and artifact, which the editor
shows. A JSX element is the toolkit's view and the platform's root view
at once (`View & UIView`), so a component returning native JSX is
declared as returning `UIView` (or `View`); its root is the returned
tag's class. These declarations exist only under the switch, cached
apart from the others, which stay as they were.

**Lowering.** The JSX is compiled as the setup a person would write.
Each view is made when the component mounts, in source order, a parent
before its children. Each prop is an effect of the mount, as a toolkit
body's value is: evaluated now and whenever what it read changes, and set
through its binding plan; a bare attribute is `true`, set once. An event's
handler is evaluated once and registered (a listener proxy on Android, a
UIAction for the control's event mask on iOS, through
`lucent::objc::addControlAction`), and taken back when the mount ends,
which breaks the cycle through the handler. Children are inserted in order.

**Where it is returned.** Native JSX is setup code, and setup runs once
per mount, so the component may return it from any of its own code: the
last statement, a PLATFORM branch or guard, a ternary's arms, or any
condition (`if (available("ios", 17)) return <UIButton
isSymbolAnimationEnabled />`). A one-file component returns each
platform's views from its branch, and each platform's program keeps only
its own; one platform's branch may return a toolkit's body (SwiftUI's,
Compose's) and the other native views. A root chosen by a runtime
condition is chosen once per mount: a later change of what it read does
not swap it, and a signal read there is not tracked, nor warned about as
a prop read once is (LUCENT3021). What it may not be is a
value: JSX kept in a variable, or made by a function of setup's.
Unlike a toolkit body, which compiles to one Swift or Kotlin body,
nothing here asks for a single return.

**Children that come and go (T49).** A child may be a branch or a keyed
list:

```tsx
<UIStackView spacing={4}>
  <UILabel text={props.title} />
  {props.showNote && <UILabel text="note" />}
  {props.dark ? <UILabel text="dark" /> : <UILabel text="light" />}
  {props.rows.map((row) => (
    <UILabel key={row.id} text={row.title} />
  ))}
</UIStackView>
```

With one among a parent's children, each child is a region of the
parent's children (`lucent/ui_children.h`), inserted where the regions
before it end, and the parent's class gives what removes and moves one:
iOS's `remove<X>:` beside its `insert<X>:atIndex:` and then the child's
`removeFromSuperview` (a move inserts again: UIKit moves a view it has),
Android's `removeView`.

- **A branch** (`cond && <X />`, `c ? <X /> : <Y />`, nested, a side
  `null`, `undefined` or `false`) is an effect choosing which element
  shows. The element shown is made in a scope of its own, its props'
  effects and its events there; when another shows, that scope ends and
  its view leaves. A condition is JavaScript's truthiness: `{0 && <X />}`
  shows nothing (React would show the text `0`, which a native view
  cannot hold).
- **A keyed list** (`items.map((item) => <X key={item.id} … />)`) is
  one element per key, made once in a scope of its own, never per commit.
  Arrays and items are values: a new array (a commit gives one) reconciles
  the list; mutating one in place notifies nothing. A kept key whose item
  is another value has it written to the item's signal, so only the
  bindings reading `item` rerun, its view and scope kept; an event of the
  item is registered again with the new item. A key gone ends its scope
  (its effects, listeners and tasks, once) and lets its view go. Keys are
  a string or a number, unique and never NaN: an array breaking that
  throws, naming the key, and the list keeps its children. Moves walk the
  new order (`[a,b,c]` to `[c,a,b]` is one move, no create or remove); no
  longest-increasing-subsequence step until one is measured to matter.

**Layout (T50).** A plain view's children have no layout of their own.
`Flex`, from `lucent:ui`, is a container laid out by React Native's own
Yoga (no second Yoga is bundled):

```tsx
<Flex style={{ flexDirection: "row", gap: 8, padding: 12 }}>
  <UILabel text={props.title} layout={{ flexGrow: 1 }} />
  <UISwitch isOn={props.on} />
</Flex>
```

- **Who owns what.** The tag decides, never a prop. A Flex writes its
  direct children's frames, at each of its layouts, and nothing else
  writes them. Its own frame is its parent's: Fabric for the component's
  root (it fills the content box), a native container, or an enclosing
  Flex. A native container among its children (a stack view, a
  LinearLayout) lays out its own children, which the Flex never touches.
  A plain view's children stay unmanaged.
- **Style.** `style` places a Flex's children, and a child's `layout`
  places it, in React Native's layout names and values: numbers in points
  (dp), `"50%"`, `"auto"` where Yoga takes it, enums as React Native
  spells them. Each key is an effect, set again when what it reads
  changes; undefined restores React Native's default. Both are object
  literals, and a nested Flex may not set one key in both.
- **The tree.** Flexes inside one another make one Yoga tree. The
  outermost lays it out at its bounds (in its platform's layout pass:
  `layoutSubviews`, `onLayout`), snapped to the screen's pixels, in its
  view's layout direction; each Flex then places its own children. The
  runtime keeps the logic in a plain core, `lucent/layout.h`, which
  `platform/ios_layout.mm` and `platform/android_layout.cpp` (with
  `dev.lucent.LucentFlexView`) adapt.
- **Leaves.** A child that is no Flex is measured by what it says of
  itself. On iOS: `sizeThatFits:` where its class overrides it; Auto
  Layout where its own constraints lay its content out (a stack view's);
  else its intrinsic size (a plain view's is none: zero). On Android:
  `View.measure`. A measured size rounds up to the pixel grid, so text is
  never cut. No leaf is measured by the frame a Flex gave it, which would
  feed a frame back into its own measurement.
- **Laid out again** when its tree changes (a key set to another value,
  a child inserted or removed: Yoga's dirty marks reach the root, which
  asks its platform for a layout), and when its mount's code has run.
  Then every leaf is measured again, since the code may have changed what
  they show. That is the signal sizing by content hears (`Content`, whose
  listeners run before the host measures), with the same limitation: a
  change no code of the mount makes needs `invalidateSize()`.
- **Sizing by content.** A component whose root is a Flex is measured
  through its tree: iOS `sizeThatFits:`, Android `onMeasure`. The tree
  fits the bound, laid out again at the bound where it would exceed it
  (text wrapping to it).
- **Lifetimes.** On Android a Flex's C++ side lives as long as the scope
  it was made in (its mount's, an item's, a branch's); after it the view
  lays nothing out. On iOS the view owns it.

**Diagnostics.** LUCENT3025: native JSX the component does not return
as it is, from its own code, a spread attribute, a child that is not a native view's
element, a class with no constructor to make it with (and no `create`),
a prop reading a copy setup made of a prop (`const title =
props.title`), which would never change; a list's element without a
`key`, a list's index parameter (indexes change as items move), a
callback giving anything but one element, a `key` outside a list, a
list inside a condition or inside a list's item, or an Android parent
with no `removeView` among dynamic children; `layout` on an element whose
parent is no Flex, a `style` or `layout` that is no object literal, a key
a nested Flex sets in both, and other attributes on a Flex. An attribute the rules leave out
is TypeScript's error with the rule's reason after it. An attribute's
code is setup code: the main thread's rules (LUCENT3022) hold in it.

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
- Platform-view JSX (T48): a plain view's children have no layout; a
  Flex's are Yoga's (T50), a stack view or an Android layout lays out its
  own. A list's item is one element (no fragment), and a list inside an
  item is its own component's. A Flex inside a native container is sized
  when its container asks (`sizeThatFits:`, `onMeasure`); a stack view
  laying a Flex out by Auto Layout sees no intrinsic size. Physical
  devices have not run a Flex yet (V8).
  Rules read declarations, not behavior: Android's AdapterView declares
  `addView(View, int)` and throws from it. A view made through a Swift
  initializer needs `create`. A pod's view whose superclass module
  (UIKit) is not imported has no attributes until it is (TA33).

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
once, in a `const` at its top level (or at the top level of a PLATFORM
branch, `if (PLATFORM === "ios")` or a case of `switch (PLATFORM)`, in a
one-file component), and puts it in the view it returns:

```tsx
export function Card(props: { title: string; children?: Children }): UIView {
  const card = new UIView({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  const content = slot<UIView>();

  card.addSubview(content);

  return card;
}
```

`slot<T>()` names the platform's container class, UIKit's `UIView` or
Android's `ViewGroup`, and the compiler refuses any other. It also
refuses children without a slot, a slot without children, a second slot,
a slot made anywhere but a top-level `const` of setup or of its PLATFORM
branch (another platform's branch is not the platform's code; a branch
under another condition too, `PLATFORM === "ios" && ready`, runs only
when it holds, so it is not a place for the slot), and setup reading
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
   and command, after the mount's code changes its content with neither
   (a native timer's, an animation's callback), when the host lays out,
   and when the slot moves or resizes. On Android the slot passes its place on at each of its
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
before each frame. On iOS the mount's own code moving a native view (a
native timer's or an animation's callback) marks its content changed, and
the slot lays out on UIKit's next pass (TA26); a move no code of the
mount makes (a Core Animation animation running on its own) takes the
slot along at the component's next layout.

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
