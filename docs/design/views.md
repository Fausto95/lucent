# Views: Lucent components in React Native's renderer

Status: in preview. Every compile generates this for the components it finds
([0047](../decisions/0047-views-without-a-switch.md)), and the API may change
until the view gate closes ([parity.md](../parity.md#views)).

A component is an exported function of a `.lucent.tsx` module that returns a
native view. Its setup is compiled to C++ and runs on the main thread, once per
mount. React sees an ordinary component: its props, its events as callback
props, and a ref to its host view, which has the commands setup exposes.

[C-VIEW](contracts.md#c-view-components-and-views) states the contract; this
page records how the code keeps it, and [Limits](#limits) its gaps. Compiler
paths are under `packages/compiler/src/`, runtime paths under
`packages/runtime/`.

```tsx
// meter.ios.lucent.tsx
import { effect, expose, signal } from "lucent:ui";
import { UILabel, type UIView } from "lucent:ios/UIKit";

export function Meter(props: { value: number }): UIView {
  const label = new UILabel();
  const taps = signal(0);

  effect(() => {
    label.text = `${props.value} (${taps.get()})`;
  });
  expose({ tap: () => taps.set(taps.peek() + 1) });

  return label;
}
```

## The component model

### What a component is

An export of a `.lucent.tsx` module is a component when every value it returns,
in the target platform's code, is a view (`ui/roots.ts`). A view is an object of
a class deriving from the platform's root view class (`UIView`,
`android.view.View`), or a toolkit's element. Ancestry in the installed SDK
decides, never a list of classes. The root class is the nearest class common to
every returned value ([Bodies](#bodies)). On Android a `Fragment` is a root too
(androidx's), and on iOS a `UIViewController` (UIKit's), which the host contains
([iOS](#ios), [Android](#android)). A setup returns one kind of root on every
path.

A component is a function declaration, or an `export const` holding an arrow or
a function expression, taking one props object or none. It is described for its
hosts, never exported to JavaScript as a function, and Lucent code can't call it
or hold it as a value.

LUCENT3020 refuses a promise of a view, or a view on some paths and another
value on others. It refuses type parameters, more than one parameter,
destructured props and a props type that is no object. So are several names in
one `export const`, and a module no named `package.json` owns. LUCENT3023
refuses a component on one compiled platform only, or whose contract differs
between platforms or from its shared declaration (`ui/merge.ts`).

### Identity and registration

A component's id is `<package>/<module path>#<export>` (`ui/identity.ts`). A
Lucent package's module path is under its sources; an app's is under the nearest
`package.json`, which must have a `name`, or the component has no identity. Platform suffixes and extensions are stripped, so
split files share one id.

The registration name is `Lucent<export>_<hash>`, the hash being the first 12
hex digits of the id's SHA-256. It is valid in C++, Objective-C and Java, and is
Fabric's component name. The hosts register `<registration>ComponentView` on iOS
and `dev.lucent.generated.<registration>Manager` on Android.

The app imports a component as `lucent:views/<module>`
([0037](../decisions/0037-the-app-imports-a-component-as-lucent-views.md)).
TypeScript reads `types/views/<module>.d.ts`, which `lucent build` writes. Metro
resolves the name to `js/_lucent/components/<module>.js`, which requires the
component's own module, so React Native registers the view once.

### The setup

The function's body is its setup. It runs once per mount, on the main thread, in
Lucent's main context. A mount is one run of setup on one host view, for as long
as that view shows that component instance. A later commit never runs setup
again: it writes the props' signals.

Setup makes the native objects it shows (`new UILabel()`), wires them up and
returns the root; they belong to the mount. Every function setup makes (an
effect, a handler, a native callback) enters the mount when it runs, so the host
hears of it (`Content`, `lucent/view.h`). A mount holds a scope under the main
context's root, a prop inbox, a signal per prop, the command table and the root
view (`views/<registration>_mount.cpp`).

### lucent:ui

`packages/compiler/lib/sdk/ui.d.ts` declares them. Outside a setup and the
functions it makes, they are LUCENT3021.

| Helper                                | What it does                                                              |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `signal(initial)`                     | A value of the mount: `get()` tracks, `peek()` doesn't, `set(v)` notifies |
| `effect(() => …)`                     | Runs now, and again after a prop or signal it read changes                |
| `onDispose(() => …)`                  | Runs when the mount ends; inside an effect, before its next run           |
| `expose({ … })`                       | The ref's [commands](#commands)                                           |
| `slot<T>()`                           | The view [React children](#children-and-slots) go in                      |
| `invalidateSize()`                    | Has the host [measure](#the-content-revision) the view again              |
| `bind(signal)`, `range(from, to)`     | Written where a [toolkit body](#toolkit-bodies)'s view takes them         |
| `Flex`                                | A [Yoga container](#flex-and-yoga) in native-view JSX                     |
| `Children`, `Continuous`, `Coalesced` | Types: React children, event deliveries                                   |

### Signals, effects and props

The graph is `lucent/reactive.h`, owned by the main context. A signal notifies
when a write changes it by `Object.is`: an object by identity, so mutating one
in place notifies nothing. Writes inside a transaction, an effect or a cleanup
wait for its end, which runs the pending effects in the order they were made.

Setup runs inside a transaction, with the mount's scope current. Each effect run
replaces what the last one read, and its cleanups and nested effects end before
the next run, in reverse order. An effect about to run more than 100 times in
one update stops it, reported with the effects that triggered each other.

`props.name` reads the prop's signal (`propMember`, `emit/setups.ts`), tracked
inside an effect, native-view JSX or a toolkit body. A read in setup's own code
happens once, and LUCENT3021 warns. Using the props object whole, reading
`props.children` and reading an event as a value are LUCENT3021.

### Lifetime and errors

The mount ends at unmount or recycle (`Mount::dispose`). Disposal closes the
prop inbox and disposes the mount's scope in a transaction: effects stop and
`onDispose` cleanups run. It then clears the event routes, releases the root
view and rejects the requests it still owes.

Setup ends what it started with `onDispose`: timers, observers, listeners set by
hand. What `present` (`lucent:ios`) shows from the mount's code belongs to the
mount's scope, which the mount's content holds (`ownContent`), so disposal
dismisses it. It presents from the setup's root when that is a view controller
in a window with nothing presented over it, else from the scene's top view
controller. After an `await`, the code runs outside the mount: give `present` an
`AbortSignal` that `onDispose` aborts
([0119](../decisions/0119-what-a-components-code-presents-belongs-to-its-mount.md)).

A setup that throws, or lacks a required prop, is reported with the component's
id and source line (`reportViewError`). The mount then ends at once: the host
shows nothing, and requests are rejected. A prop of the wrong type is logged and
read as missing, as React Native's props fall back to their defaults. A later
commit lacking a required prop is reported, and the rest of it applies.

### A component's view in module code

A module function takes a component's view as lucent:ui's `ComponentView`:
JavaScript passes the component's ref. The views runtime records the host view's
tag on the ref, and the binding takes the mount that tag has then
(`lucent/component_view.h`). Each host records its mount's root as setup
returns it and forgets it as the mount ends, so `viewOf` (lucent:ios,
lucent:android) gives the root inside `main()`, and an `InvalidStateError` once
the mount has gone ([0120](../decisions/0120-a-components-ref-crosses-to-module-code-as-a-component-view.md)).

## Bodies

What setup returns decides how the component draws; the rest of this page holds
for every kind.

| Body            | Written as                           | Root                      | Its views are laid out by      |
| --------------- | ------------------------------------ | ------------------------- | ------------------------------ |
| Imperative      | Code making platform views           | The returned view's class | Native containers, or nothing  |
| Native-view JSX | JSX of UIKit or Android view classes | The returned tag's class  | Native containers, or a `Flex` |
| A `Flex`        | `<Flex>` of native-view JSX          | The declared root class   | Yoga                           |
| SwiftUI         | JSX of `lucent:swiftui`              | `UIHostingController`     | SwiftUI                        |
| Compose         | JSX of `lucent:compose`              | `ComposeView`             | Compose                        |

A one-file component writes each platform's body in that platform's code
([0013](../decisions/0013-one-file-components.md)). That is a `PLATFORM` branch,
the code after a guard that returns, or a top-level declaration using one
platform's code. Split files (`x.lucent.ts`, `x.ios.lucent.tsx`,
`x.android.lucent.tsx`) stay supported, and platforms may differ in kind
([0036](../decisions/0036-native-jsx-returns-from-any-of-setup-s-own-code.md)).

An imperative setup is ordinary Lucent code against the SDK: it builds a view
tree, subscribes to what it needs, and returns the root. Effects keep native
state in step with props and signals. A platform callback setup registers runs
in the main context, never under a package's lock (`callbackEntry`,
`emit/setups.ts`). Android setup code makes views with `appContext()`, the
Application context ([Limits](#limits)).

## Platform views as JSX

A component may return its platform's views as JSX. Nothing about the views is
listed in Lucent: what a tag takes comes from its class's declarations, by rule
(`sdk/view-rules.ts`,
[0027](../decisions/0027-native-views-jsx-derives-children-no-adapters.md)). A
subclass inherits its classes' attributes, and the nearest class wins
(`viewTag`).

```tsx
// settings.ios.lucent.tsx
export function Settings(props: Props): UIView {
  return (
    <UIStackView spacing={8}>
      <UILabel text={props.title} numberOfLines={1n} />
      <UISwitch isOn={props.enabled} onValueChanged={(s) => props.onToggle?.(s.isOn)} />
    </UIStackView>
  );
}
```

### The rules

| Attribute    | iOS                                                                | Android                                                     |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Props        | Writable instance properties                                       | Writable Kotlin properties, and one-value `set<X>` methods  |
| Events       | `on<Case>` per single-bit case `addAction:forControlEvents:` takes | `on<X>` for `setOn<X>Listener(L)`, where `L` has one method |
| Children     | The nearest `insert<X>:atIndex:`                                   | `addView(View, int)`                                        |
| Removing one | Its `remove<X>:`, then the child's `removeFromSuperview`           | `removeView(View)`                                          |
| Construction | `initWithFrame:` with a zero frame, else `init`, own or inherited  | The `(Context)` constructor, given the hosting view's       |

A setter's overloads are one prop, and the value's type picks one. A generic
setter and a listener of several methods (a `TextWatcher`) are left out, for
setup code. An iOS handler gets the tag's own class (`(s: UISwitch) => …`). Any
tag may say how its view is made, `create={() => new MyChart(frame)}`, which a
class the rules can't make needs.

A class's declaration gives its attributes under `"~jsx:<module>.<class>"`,
typed with the class (`this`), and the root view's `"~jsx"` gathers them
(`NativeAttributes`). An element is the toolkit's element and the root view at
once (`View & UIView`), so the component declares the root view class.
`lucent sdk coverage --views` lists each tag's attributes and refusals.

### Lowering

The JSX is compiled as the setup a person would write (`emit/native-jsx.ts`).
Each view is made at mount, in source order, a parent before its children;
Android views take `lucent::jni::viewContext()`: the shell's context while the
host calls the mount (its setup, an update, a command), else its root view's (a
callback its setup made), so a view made on a later commit is themed as setup's
were ([T125](../tasks.md#t125)). Each prop with a value is an
effect of the mount, set now and whenever what it read changes. A bare attribute
is `true`, set once.

An event's handler is evaluated once and registered: a listener proxy on
Android, a `UIAction` for the control's event on iOS
(`lucent::objc::addControlAction`). It is taken back when the mount ends,
breaking the cycle through the handler.

Native JSX is setup code, so a component may return it from any of its own code.
That covers the last statement, a `PLATFORM` branch, a ternary's arms and any
condition (`if (available("ios", 17)) return …`). JSX kept in a variable, or
made by a function of setup's, is LUCENT3025. Attributes are setup code, so
LUCENT3022 holds in them.

### Children that come and go

A child may be a branch or a keyed list (`lucent/ui_children.h`). Each child is
then a region of its parent's children, inserted where the regions before it
end.

- **A branch** (`cond && <X />`, `c ? <X /> : <Y />`, nested, a side `null`,
  `undefined` or `false`) is an effect choosing which element shows. The element
  shown lives in a scope of its own, which ends when another shows. Conditions
  are JavaScript's truthiness: `{0 && <X />}` shows nothing, where React would
  show the text `0`.
- **A keyed list** makes one element per key, once, in a scope of its own. A
  new array reconciles it, and mutating one in place notifies nothing. A kept
  key gets its new item in the item's signal, so only bindings reading `item`
  run again, and its handlers are registered again.
- **A key that goes** ends its scope and lets its view go. Moves walk the new
  order: `[a,b,c]` to `[c,a,b]` is one move. Keys are strings or numbers, unique
  and never NaN, or the update throws before anything changes.

LUCENT3025 refuses a list's element without a `key`, a `key` outside a list, and
an index parameter. It refuses a callback returning anything but one element,
and a list inside a condition or an item. Spread attributes, a tag that is no
SDK view and an attribute the class doesn't take are refused too. So are an
attribute reading a copy of a prop (`const t = props.title`), and an Android
parent with no `removeView` among dynamic children.

## Flex and Yoga

A plain view's children have no layout of their own. `Flex`, from `lucent:ui`,
is a container laid out by React Native's own Yoga, with no second Yoga bundled
([0031](../decisions/0031-native-views-are-laid-out-by-a-flex-tag.md)).

```tsx
<Flex style={{ flexDirection: "row", gap: 8, padding: 12 }}>
  <UILabel text={props.title} layout={{ flexGrow: 1 }} />
  <UISwitch isOn={props.on} />
</Flex>
```

- **Ownership.** The tag decides, never a prop. A Flex writes its direct
  children's frames at each of its layouts, and nothing else writes them. A
  native container among them (a stack view, a `LinearLayout`) lays out its own
  children.
- **Style.** `style` places a Flex's children, and a child's `layout` places
  it. Both take React Native's names and values: points (dp), `"50%"`, `"auto"`
  where Yoga takes it. Each key is an effect; undefined restores the default,
  and an invalid value throws (`lucent/layout.h`).
- **One tree.** Nested Flexes make one Yoga tree. The outermost lays it out at
  its bounds in its platform's layout pass, snapped to the screen's pixels, in
  its view's direction.
- **Leaves.** A child that is no Flex says its size. iOS asks `sizeThatFits:`
  where its class overrides it, else Auto Layout where its constraints lay it
  out, else its intrinsic size. Android asks `View.measure`. No leaf is measured
  by the frame a Flex gave it.
- **Relayout.** A tree lays out again when a key or a child changes, and when
  its mount's code has run, measuring every leaf again. A component whose root
  is a Flex is measured through its tree.

`lucent/ui_flex.h` declares a Flex; `platform/ios_layout.mm` (a UIView) and
`platform/android_layout.cpp` with `dev.lucent.LucentFlexView` define it. An
Android Flex's C++ side lives as long as the scope it was made in. A Flex takes
`style`, children, `layout` in a Flex and `key` in a list. Anything else, and
`layout` outside a Flex, is LUCENT3025.

## Toolkit bodies

A component may draw with SwiftUI (`lucent:swiftui`, generated from the
installed SDK) or Jetpack Compose (`lucent:compose`, from the Compose release
Lucent builds with). The body is the JSX setup returns once, as the last
statement of its platform's code, with conditions inside it. It is found by its
type, with no wrapper call (`bodyOf`,
[0012](../decisions/0012-jsx-for-swiftui-and-compose-with-no-wrappers.md)). It
is written out in the toolkit's language, and meets the rest of setup through
slots (`ui/toolkit-body.ts`, `emit/toolkit.ts`).

```tsx
// toggle.lucent.tsx: one file; Text from lucent:swiftui, CText and Modifier from lucent:compose
export function Toggle(props: { title: string }) {
  const on = signal(false);
  const flip = () => on.set(!on.get());
  const label = () => `${props.title}: ${on.get() ? "on" : "off"}`;

  if (PLATFORM === "ios") return <Text onTapGesture={flip}>{label()}</Text>;

  return <CText modifier={Modifier.clickable(flip)} text={label()} />;
}
```

A `*.ios.lucent.tsx` file's JSX is typed by `lucent:swiftui`, and a
`*.android.lucent.tsx` file's by `lucent:compose`. A shared file's JSX runtime
is `lucent:jsx`, whose element is every toolkit's at once (`View & Composed`). A
toolkit's names outside its platform's code are LUCENT3024, and a toolkit whose
SDK is missing is left out.

### Slots between setup and body

| Slot   | What it is                                                        | How it crosses                                                                   |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Value  | Plain data the body reads: `on.get()`, `props.title`, a template  | An effect computes it with JavaScript's semantics, then sets the toolkit's state |
| Action | A setup function the body calls from a callback, or passes as one | The toolkit calls it on the main thread; it runs in its mount                    |
| List   | An array the setup computes, shown item by item, each keyed       | An effect sends records (`[key, value…]`), merged by key                         |
| Bound  | `bind(signal)` of a number, a boolean or a string                 | The view shows the signal, and a change the user makes sets it                   |

A value slot is the largest expression of setup's values the body reads. Its
effect runs at mount and whenever what it read changes, so the body never shows
a value older than the latest commit. Numbers, booleans and strings cross as
they are. Other values cross encoded (`emit/toolkit-values.ts`), an object as
its fields in declared order, read back as a Swift struct or a Kotlin data
class.

An action's arguments are numbers, booleans or strings its callback gives (its
parameters, literals), and what Lucent code computes for the call: what reads the
setup's or the module's names (`() => pick(props.title, tapped())`). The setup
computes those when the action runs, in order and in its mount, as JavaScript
evaluates a callback's arguments (`actionFn`, `emit/toolkit.ts`). A
list's item crosses as its key, and setup finds the item again or does nothing
once it is gone. An item keeps its model while its key stays, and shows no list
of its own and binds no signal, for now. `range(from, to)` is SwiftUI's closed
range `from ... to`.

The body holds no logic of its own. It doesn't change setup's state, send events
or call a setup function while it draws (LUCENT3024).

### SwiftUI

- **Elements.** An element is a view's initializer. An attribute named like one
  of its labels is that argument, winning over a modifier of that name. The
  children are the trailing `@ViewBuilder`'s content, or the first unlabeled
  string.
- **Modifiers.** Every other attribute is a modifier, applied in the order
  written: one value, an object of labeled ones, or a tuple of both. One given
  again chains after the element: `(<Text padding={8}>a</Text>).padding(4)`.
- **Values and content.** SwiftUI's values are calls in the call form
  (`Animation.spring({ response: 0.3 })`), and views in content are JSX. A
  conditional view is SwiftUI's `if`, on a `boolean` condition.
  `<ForEach data={items} id={(i) => i.id}>` is Lucent's keyed list, and
  `Environment((v) => v.colorScheme)` an `@Environment` property.
- **Animation.** `withAnimation(animation, body)` in setup code runs SwiftUI's
  around the Lucent `body`, whose writes' effects run inside it, so the model's
  changes animate.

The generated `views/<registration>.swift` holds an `ObservableObject` model (a
`@Published` property per value slot), the body's `View`, and `@_cdecl`
functions setup's C++ calls. Each mount makes its own `UIHostingController`. It
takes no safe-area insets (`safeAreaRegions` empty, iOS 16.4), since React
Native places its box, and its background is clear.

The controller tracks its content's ideal size (`sizingOptions`, iOS 16). A
change of it, SwiftUI's own included, marks the mount's content changed. The
report goes to the host only: UIKit's `preferredContentSize` setter is never
called, so a sheet holding the component never resizes to it.

### Compose

- **Elements.** A composable showing UI is an element, its props Kotlin's named
  arguments and its children its trailing content lambda. A prop written alone
  is `true`.
- **Scopes.** Content run in a receiver scope may be a function of it:
  `<Row>{(row) => <Text modifier={row.Modifier.weight(1)} />}</Row>`. A lazy
  list's items are its scope's elements:
  `<list.items items={todos.get()} key={(t) => t.id}>`.
- **Composition statements.** A statement of the component's own code that
  calls or reads a composable (`remember`, `animateDpAsState`,
  `LocalDensity.current`) is lifted into the content (`ui/composition.ts`). It
  runs at each composition, in order, before what the JSX shows.
- **Their rules.** It stands at the top of the component's code, never in an
  `if`, a loop or a setup function. It may read setup's values and earlier
  composition values, and setup code never reads its values.

The generated `dev/lucent/compose/<registration>.kt` holds a state class, the
`@Composable` content and a host object. The runtime's `LucentComposition` makes
the `ComposeView` with the hosting view's context, so the body sees the
Activity's theme. The composition starts at the view's first attach, and
survives the detaches React Native makes as it clips, moves or pools views.

The mount's end disposes it, as does the destruction of the view tree's
lifecycle. A mount that ends before its view attaches never composes. A window
lacking a lifecycle, saved-state or view-model owner gets the Activity's, and
`rememberSaveable` restores nothing another mount saved. The content lays out at
its own size, unclipped; a size change asks for a layout, and the host measures
again.

### Helper views

A body may split its views into helpers: non-exported functions of the same
platform code returning its toolkit's JSX (`ui/view-helpers.ts`). Each is
written once per component as a Swift `View` or a Kotlin `@Composable` function,
never as C++. It takes one props object of plain data, scalar callbacks and its
toolkit's values, and setup computes what it derives from the plain data where it
is used. A toolkit's value (a `Color`, a `Font`, a `Modifier`) is a parameter of
the toolkit's type: its user writes it where it draws, an optional one is `nil`
or `null` when left out, and `??` defaults it. A bound prop (`on: Bound<boolean>`)
is a Swift `Binding`, or a Kotlin value and its change callback (`on`,
`onChanged`): its user gives it `bind(signal)` or a bound prop of its own, and its
views show and change it. Children (`children: Content`, Compose's `Shown`) are
a content closure of its view, `@ViewBuilder let content` or `content:
@Composable () -> Unit`, which its user's element holds and `{props.children}`
shows. Its props may be destructured, `({ title, done: isDone })`, each name
reading the prop it names. A default, `...`, a nested pattern or a list of its
own is LUCENT3024 ([T123](../tasks.md#t123)).

## Props

### Supported types

A component's props are its props parameter's properties, in declaration order,
and they are plain data (`ui/describe.ts`, `ui/values.ts`).

| TypeScript                                         | View type  | C++ in the commit             |
| -------------------------------------------------- | ---------- | ----------------------------- |
| `number`, numeric literal unions                   | `number`   | `double`                      |
| `boolean`                                          | `boolean`  | `bool`                        |
| `string`                                           | `string`   | `std::string`                 |
| String literal unions (`"a" \| "b"`)               | `enum`     | a generated `EnumN_` struct   |
| `T[]`, its elements never `undefined`              | `array`    | `std::vector<T>`              |
| Object types declared in Lucent code, mapped types | `object`   | a generated `ObjectN_` struct |
| `T \| null`                                        | `nullable` | `std::optional<T>`            |
| An exported class, in a prop only                  | `instance` | `lucent::views::Instance`     |

An optional prop (`?`, or `undefined` in its type) may be missing, as may an
object's optional field and a command's optional parameter. Refused, with the
path to the problem: bigint, tuples, mixed unions, index signatures and
recursive types. So are library objects (`Date`, `Map`, `Uint8Array`), native
objects, promises, nested functions and values of unknown or generic type. An
instance of a class its module doesn't export, or of a generic class, is
refused too, and so is one in an event or a command.

### Instances

A prop may be an instance of an exported class: alone, `T | null`, or in an
array ([0075](../decisions/0075-instances-of-exported-classes-as-view-props.md),
[0098](../decisions/0098-an-instance-prop-is-held-from-its-commit-and-checked-by-member.md)).
It travels as its id ([Events](#events) has the keys), and the commit's props
hold it from the JavaScript call that commits. The mount's signal holds it
while it shows it, so it lives until its JavaScript object, every commit and
mount that has it, and Lucent code let it go.

A view's code runs on the main thread without its module's lock. So the
members of an instance it reaches follow the rule module variables follow
(`analysis/view-members.ts`). A member only main-thread code uses is the
main thread's, and one nothing writes once its instance is made may be read
anywhere. One that code off the main thread uses too, either of them writing
it, is LUCENT3022 where the view uses it.

| Use                                                         | Side                |
| ----------------------------------------------------------- | ------------------- |
| The setup, functions it makes, and what they call           | The view's          |
| A `main()` callback                                         | Neither: it locks   |
| Code anything but the main thread runs (module code, tasks) | Off the main thread |
| JavaScript reading a public field, or writing one           | Off the main thread |
| The class's construction                                    | Neither: it's first |

A use of a member holding an array, a collection, a library object or a
plain object counts as a write, since it may change what it holds. One
holding an instance is a use of that instance's members, checked in turn.
The React types import the class from `lucent:module/<module>`, which
`lucent build` writes as the module's own exports.

In a SwiftUI or Compose body the instance stays in C++
([0121](../decisions/0121-an-instance-prop-stays-in-cpp-in-a-toolkit-body.md)).
The body shows what the setup computes from it, a member's value or a
method's result, as value slots read on the main thread when the prop
changes. Setup functions call its methods; the body calling one itself is
LUCENT3024. A list of instances is a list slot whose items stay in C++
([0122](../decisions/0122-a-toolkit-bodys-list-may-show-instances.md)):
its records hold what the setup computes for each, and an action given an
item finds it again by its key.

### Missing, null and unchanged

A commit holds each prop missing, null or a value, and each differs from
unchanged. React sends a removed prop as `null`, and turns `undefined` into
`null` inside objects and argument lists. So the proxy boxes a nullable value:
`[value]`, or `[null]` for null.

| JavaScript gives                 | The commit holds                      | Setup sees  |
| -------------------------------- | ------------------------------------- | ----------- |
| No change of the prop            | the last commit's value               | no change   |
| `undefined`, or the prop removed | missing                               | `undefined` |
| `null` for a `T \| null` prop    | `[null]`: present, and null           | `null`      |
| A value                          | the value, or `[value]` when nullable | the value   |

`Props::changed` compares each prop with the previous commit's: numbers by
`Object.is`, arrays and objects by contents. Only changed props are written to
their signals, all in one transaction. A missing required prop is a `TypeError`
(`lucent::views::required`).

### Reserved names and style

`key` and `ref` are React's, and the ref is the host view's own. `children` is
allowed only typed `Children`, and `style` is the host's. A function prop is an
event, named `on` and a capital letter; one named otherwise is LUCENT3021, which
suggests the name.

`style` styles and places the host view. iOS's host is an
`RCTViewComponentView`, which draws borders and backgrounds. Android's shell is
a `FrameLayout` under a `SimpleViewManager`, which draws no borders, though
their width still insets the content.

## Events

An event is a callback prop named `on[A-Z]…`, returning nothing, its parameters
plain data. Its slot is its index among the events, in prop order: JavaScript
keeps the function, and the view holds the slot. An event returning a value is
LUCENT3021: give the view the value as a prop instead.

Setup sends one by calling the prop, `props.onChange?.(v)`. The call evaluates
its arguments, copies them and posts them along the event's route, and returns
`undefined`. The route delivers only while JavaScript listens to that event and
the mount lasts. It asks the host for its event emitter, which is null once the
view holds another mount.

The payload is `{ args: [...] }`, built on the JavaScript thread, by position:
React Native adds the view's tag as `target`. An omitted optional argument is
`undefined`, and trailing omitted ones aren't sent.

| Delivery               | The prop's type              | React Native                     | JavaScript hears                          |
| ---------------------- | ---------------------------- | -------------------------------- | ----------------------------------------- |
| discrete (the default) | `(v: T) => void`             | `RawEvent::Category::Discrete`   | every event, at React's discrete priority |
| continuous             | `Continuous<(v: T) => void>` | `RawEvent::Category::Continuous` | every event, at a lower priority          |
| coalesced              | `Coalesced<(v: T) => void>`  | `dispatchUniqueEvent`            | the latest of a run still waiting         |

Marking an event both ways is LUCENT3021. Through React Native 0.88, continuous
maps to React's default priority unless the app turns on
`fixMappingOfEventPrioritiesBetweenFabricAndReact`. Events queue while
JavaScript is busy, and the native side never waits; only coalesced ones are
ever replaced.

A view's events arrive in the order setup sent them. A coalesced event replaces
the view's waiting one only when that is the view's latest, of its type. It
takes that one's place, so another view's event queued between comes after it.
Events and requests' answers travel on separate channels, with no order between
them.

Short keys (`ui/transport.ts`) never meet React Native's view props or its key
length limit, and shared event names keep its registry unambiguous.

| What                  | Key                                    | Example      |
| --------------------- | -------------------------------------- | ------------ |
| The prop at `index`   | `p<index>`                             | `p0`         |
| The handler in `slot` | `e<slot>`, true while listened to      | `e1`         |
| The native event      | `lucent<slot>`                         | `lucent1`    |
| React Native's name   | `topLucent<slot>`, mapped to `e<slot>` | `topLucent1` |

An instance prop travels as a number (`rn/LucentViewInstances.h`): its
runtime's id times 2^32, plus the instance's number in that runtime. The
views runtime asks the Lucent module for it (`__lucentViewInstance`), after
finding the class's prototype in the value's chain. A value of another
class is a `TypeError` where React renders.

The same instance has the same id while it lives, so passing it again
changes nothing. The commit's props find the instance as React Native
parses them, in the JavaScript call that commits, and hold it. The ids hold
nothing: an id whose instance is gone, or whose runtime was torn down,
reads as missing ([T120](../tasks.md#t120)).

## Commands

A component's commands come from one `expose` call, given an object literal of
functions (`ui/expose.ts`). It stands at the top level of setup, or of a
`PLATFORM` branch there, once on each platform. A member is `name: () => …` or a
shorthand naming a function (`{ reset }`).

```tsx
expose({
  reset,
  value: (): number => count.peek(),
  load: async (url: string): Promise<string> => fetchTitle(url),
});
```

LUCENT3021 refuses a method (`reset() {}`), and `expose` nested, inside a
statement, twice, given no literal, or outside a component. The functions a
literal names are checked with setup, since they run on the main thread.
Parameters and results are plain data, as props are.

The ref is the host view React Native gives the native view, a
`HostInstance`, and the commands are assigned to it, as `TextInput`'s ref
has `clear()`
([0105](../decisions/0105-a-components-ref-is-its-host-views-own.md)): what
finds a view by its ref (`findNodeHandle`, Reanimated, Gesture Handler)
finds this one. LUCENT3021 refuses a command named as a member the host view
has (`measure`, `measureLayout`, `setNativeProps`, the DOM node's, `__…`).
`focus` and `blur` may be commands: the host's send the native view the
command of their name.

| The command returns | Kind      | The ref's method returns |
| ------------------- | --------- | ------------------------ |
| `void`, `undefined` | `enqueue` | `void`                   |
| `T`, `Promise<T>`   | `request` | `Promise<T>`             |
| `Promise<void>`     | `request` | `Promise<void>`          |

A result that may be `undefined` is refused: use `null`. A command runs on the
main thread after the mount applies its pending props (`PropInbox::drain`). A
void command answers nothing, and what it throws is reported. A request answers
once: its result, its error's message, or a rejection when the mount ends first.

A request returning a promise leaves its answer owed in the mount's table, its
continuation holding the mount weakly. Its work isn't cancelled, as JavaScript's
promises aren't: setup stops its work with `onDispose`.

### The request channel

The views runtime connects once, calling the Lucent TurboModule's
`__lucentViewRequests(settle)` (`rn/LucentViewRequests.cpp`). It gets the base
of its request ids, its runtime's id times 2³². So an id names the runtime that
sent it, and two runtimes at once each get their own answers. React Native's
command name is the command's, and a request's arguments are `[id, …args]`.

1. JavaScript sends the command with the next id, and keeps the promise pending
   for this mount.
2. The host parses the arguments (`parseCommand`). A request whose arguments
   don't parse, or that reaches a view with no mount, is rejected at once.
3. The mount answers through `answerTo(host, requester)`, which drops the
   answer unless the view still holds the mount's whole token.
4. The answer is posted to its runtime's JavaScript thread, where
   `settle(id, error, value)` settles it. A torn-down runtime's answer is
   dropped.

| Case                                                           | JavaScript sees                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| A command while the view isn't mounted                         | `InvalidStateError`, thrown, or a request's rejection           |
| A request pending when its view unmounts                       | `AbortError`: `Lucent: <Component> unmounted before answering.` |
| A request whose command threw, or whose arguments didn't parse | `Error`: `Lucent: <the native message>`                         |
| An app whose native code has no request channel                | `Error` with the code `LUCENT_NATIVE_MISMATCH`                  |

## Children and slots

A component takes React children when its props declare `children?: Children` or
`children: Children`. Its setup makes the view they are mounted in, its slot,
and puts it in the view it returns.

```tsx
export function Card(props: { title: string; children?: Children }): UIView {
  const card = new UIView();
  const content = slot<UIView>();

  card.addSubview(content);
  return card;
}
```

`slot<T>()` names the platform's container class, UIKit's `UIView` or Android's
`ViewGroup`. It is called once per platform, in a `const` at the top level of
setup or of a `PLATFORM` branch (`ui/slot.ts`). LUCENT3021 refuses children
without a slot, a slot without children, a second slot, and a slot made
elsewhere (`PLATFORM === "ios" && ready` included) or of another class.

React Native owns each child: it creates, updates, frames and destroys it, and
says where it goes. The host owns the slot, a new one per mount, and keeps the
children in React Native's order in it. Setup owns the slot's place: its
ancestors, z-order and frame. The slot fills the view it is added to, unless
setup or a native container sizes it.

The slot never lays its children out. Their frames stay in the component's
coordinates, where React Native measures them (`onLayout`, `measure`), and the
slot shows them there wherever it is. On iOS its bounds origin is its own origin
in the host (`LucentSlotView`, `rn/LucentViewChildren.mm`). On Android it
scrolls its content by that origin at each layout and before each frame
(`dev.lucent.LucentSlotView`).

The slot clips its children to its bounds, so a child shows, and takes touches,
only where it falls inside the slot.

Reported, not supported: children a component doesn't take, a slot left out of
the view setup returns, and a view recycled while holding children. A toolkit
body can't show a native view, so it has no place for a slot. Containers whose
children must be the React children themselves (a collection view's cells) have
no adapter.

## Sizing and layout ownership

| Frame                              | Written by                                                   |
| ---------------------------------- | ------------------------------------------------------------ |
| The host view, the component's box | React Native, from the shadow tree's Yoga layout             |
| The root view setup returns        | The host: its content box, the frame less border and padding |
| A Flex's direct children           | That Flex, at each of its layouts                            |
| A native container's children      | The container (a stack view, a `LinearLayout`)               |
| The slot                           | Setup or its native parent, else it fills its parent         |
| React children                     | React Native, in the component's coordinates                 |
| SwiftUI or Compose content         | The toolkit, inside the root                                 |

A component whose style gives it a size, explicit or by flex, fills it. On iOS
the root is the host's `contentView`, framed to the layout's content frame. On
Android `LucentViewManager.setPadding` makes Yoga's border and padding the
shell's padding, and the root fills the rest.

### Sizing by content

A component without children and without a size of its own is sized by its
content. The renderer lays out on its own thread, and only the main thread may
measure a native view. So the two exchange results rather than calls
(`lucent/sizing.h`, `rn/LucentViewSizing.h`).

1. **Measure.** Yoga measures the shadow node (`HostShadowNode`, a measurable
   leaf). It records the bounds and returns the size its state holds, zero
   before the first measurement, never waiting.
2. **Request.** Its layout completes the bounds with the font scale and
   direction. Unless the state's measurement answers them, it records them as
   `requested`, which reaches the host with the commit.
3. **Host.** On the main thread the host measures under them, unless this
   content revision was measured so already. iOS uses `sizeThatFits:`, Android
   `View.measure` after `forceLayout()`.
4. **Post.** The size is snapped up to the physical pixel grid and posted as a
   state update, `{ size, constraints, revision }`. The host doesn't wait, nor
   post the same result again while the last is unjudged.
5. **Judge.** The renderer applies it on the JavaScript thread, if it answers
   the constraints asked now and isn't older. The size must change by a physical
   pixel or more. Yoga then lays the node out at its new size.

A measurement answers the constraints it was made under, and stricter bounds its
size fits. The content's measure is taken to be monotonic, as Yoga's cache takes
it. It never answers a looser bound, which may have cut the content, nor another
font scale or direction.

### The content revision

The revision is 1 at mount and goes up each time the mount's code has run. The
host enters the mount (`Content`) for setup, each commit and each command, and
every function setup made enters it when it runs. It counts one change when the
outermost entry on the main thread ends.

| What changes the content              | Why the host measures again                  |
| ------------------------------------- | -------------------------------------------- |
| Setup, a commit, a command            | The host entered the mount                   |
| A native callback, a timer, an effect | The function entered the mount               |
| Code after an `await`                 | It calls `invalidateSize()`                  |
| SwiftUI's own size change             | The hosting controller reports it            |
| Android content asking for a layout   | The shell's relayout backstop                |
| The iOS text size (Dynamic Type)      | `UIContentSizeCategoryDidChangeNotification` |

An Android `ComposeView` can't measure before it is in a window, so the shell
measures no content before its first layout in one. A host posts at most three
results that don't settle its state until its content changes. Then it stops and
logs it, so size and constraints can't chase each other forever.

### Slot placement

Yoga lays a component's children out in the slot's rectangle, which only the
host can measure (`lucent/slots.h`, `rn/LucentViewSlots.h`). A component taking
children is a Yoga container (`SlotShadowNode`), sized by its style, flex and
children as a View is, never by its content.

1. On the main thread, the host measures how far the slot lies in from each
   edge of the content box. It snaps them to the nearest physical pixel, and
   notes the direction.
2. It posts that as a state update when the state lacks it, once while pending.
   iOS measures each time the slot lays itself out; Android, at each layout and
   frame.
3. The renderer applies it on the JavaScript thread if it isn't older and moves
   an edge by a physical pixel or more.
4. The shadow node lays the children out as if its border were wider by the
   insets. The layout metrics the host sees keep the real border.

So a child with `flex: 1` fills the slot, and a component sized by its children
grows by the room its native views take around it. An absolute child is placed
from the slot, as a View's child is from its padding box. Before the first
report the children lay out in the content box, where a slot filling its view
already is. At most three unsettled reports are posted until the mount's native
views change.

## Recycling

React Native reuses a dropped view for the next view of its type. A recycled
view ends its mount, and its next commit starts a new one: a new token, a new
slot, setup run again. iOS always pools views, and Android does when the app
turns on `enableViewRecycling` (each manager calls `setupViewRecycling`). The
mount ends in `prepareForRecycle` or `dealloc` on iOS, and in
`prepareToRecycleView` or `onDropViewInstance` on Android.

The host gives each mount a `MountToken { tag, generation }`. The generation is
process-unique and never 0, which means no mount. Every event, answer, slot
report and measurement checks the whole token, since React Native reuses views
and tags. On a reload the dropped views end their mounts, the new runtime's
views mount afresh, and the old runtime's answers are dropped.

## Fabric integration

Each compile writes into the native package. The C++ and Swift go under
`cpp/generated/<target>/views/`.

| File                                                                                                                | What                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<registration>.h`, `.cpp`                                                                                          | `Values`, `Props` (a `ViewProps`), `EventN`, `EventEmitter`, `ShadowNode`, `ComponentDescriptor`, `CommandN`, `parseCommand`, `requestId`, the `Mount` |
| `<registration>_mount.cpp`                                                                                          | The `Mount`: signals, event routes, setup, commands, disposal                                                                                          |
| `lucent_views.h`                                                                                                    | A marker: with it, the hosts build. Each component registers itself, through its host                                                                  |
| iOS `<registration>ComponentView.mm`, `<registration>.swift`                                                        | The host class, and a SwiftUI body                                                                                                                     |
| Android `<registration>_android.cpp`, `lucent_hosts.cpp`                                                            | The mount for the C++ host, and `findComponent`                                                                                                        |
| Android `<registration>Manager.java`, `LucentViewManagers.java`, `ComponentDescriptors.h`, `react-native.config.js` | The managers and the descriptors autolinking registers                                                                                                 |
| Android `dev/lucent/compose/<registration>.kt`                                                                      | A Compose body                                                                                                                                         |

Values have plain C++ types, which the renderer may build on any thread.
`rn/LucentViews.h` reads them from React's `RawValue`, compares them and builds
event payloads; `rn/LucentViewValues.h` turns them into Lucent values and back.
The shadow node's state is `SizeStateData`: requested constraints, the
measurement, and the slot's placement.

### iOS

`<registration>ComponentView` subclasses the shared `LucentComponentView`, an
`RCTViewComponentView`. It registers with `RCTComponentViewFactory` from
`+load`, provides its descriptor, sets `_props` to its defaults in
`initWithFrame:`, and makes the mount (`lucentMount:host:`).

| React Native calls         | The host                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `updateProps:`             | Keeps the commit's `Props`                                                            |
| `updateState:`             | Gives the state to `HostSizing` and `HostSlot`                                        |
| `finalizeUpdates:`         | Mounts at the first commit, else applies a new one; shows the root; measures if asked |
| `mountChildComponentView:` | Puts the child in the slot                                                            |
| `handleCommand:args:`      | Runs the command, or rejects a request that reaches no mount                          |
| `prepareForRecycle`        | Ends the mount                                                                        |

The mount starts once a commit is final and on the main thread, never while
React renders. Every call into it enters the main context and the mount's
`Content`, and nothing it throws escapes into UIKit.

A SwiftUI component's hosting controller is contained in the nearest view
controller above the host (`addChildViewController:`). That happens as soon as
there is one, before its view enters a window. It stays that child until the
host is under another view controller or the mount ends. The host's direction
becomes its layout direction trait, which SwiftUI reads.

A component whose setup returns a UIKit view controller, such as
`AVPlayerViewController`, is contained the same way (`plainController()` on
`Mounted`). Its style or flex sizes it, or its `preferredContentSize` when it has
one, which the host observes, since UIKit tells the parent, the screen's
controller. It has no safe area, as a hosting controller has none: what the
window's safe area covers of the content goes back out of it as negative
`additionalSafeAreaInsets`
([0118](../decisions/0118-a-components-ios-root-may-be-a-view-controller.md)).

### Android

Each component's `LucentViewManager`, listed for `LucentPackage`, makes
`LucentHostView` shells: `FrameLayout`s holding the root. Autolinking registers
its descriptor wrapped in `HostDescriptor` (`rn/LucentViewsAndroid.h`), which
binds the natives (`dev.lucent.LucentViews`) and parses props for the host. Java
never passes a view's event emitter on, so the wrapper records each by surface
and tag, which together name one view across reloads
(`rn/LucentViewRegistry.h`).

| React Native calls                           | The host                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `updateProperties`                           | React Native's view props first; then the diff, merged onto the last `Props` with `cloneProps`, applied once mounted |
| `updateState`                                | Gives the state to sizing and the slot                                                                               |
| `onAttachedToWindow`                         | Mounts, the first time                                                                                               |
| `receiveCommand`                             | Mounts first if it must, then runs the command                                                                       |
| `addView`, `removeViewAt`                    | Children, to `LucentChildren`: the manager is an `IViewGroupManager`                                                 |
| `prepareToRecycleView`, `onDropViewInstance` | Drops the C++ host, ending the mount                                                                                 |

The host mounts at attach, because React Native can make a view before its props
are committed; a command may come first. The setup, each update and each command
run inside a `HostViewEntry`, which gives `viewContext()` the shell's context.
Code the mount runs at other times, in its content, takes its root view's
context: `hostContext()` (`platform/android.cpp`) reads the active content's
root, unless that is not a view (a `Fragment`).

A component whose setup returns a `Fragment` gives its host the fragment and no
view (`fragment()` on `Mounted`). The shell holds a container, a `FrameLayout`
with an id no other view in the window has (React Native's views have their
tags as ids), and `LucentFragments` adds the fragment to the Activity's
`FragmentManager` over it, once the shell is in a window, with
`commitNowAllowingStateLoss`. The container lays itself out when a view inside
asks, since React Native's views never pass the request on. A component in a
Modal, another window, shows no fragment. The fragment's view sizes the component as any
content does. When the mount ends, or a setup run again returns another, the
fragment leaves the manager. Android saves an Activity's fragments when it
recreates the Activity, and their containers go with the old views: as the
Activity is created again, `LucentActivities` drops the restored ones the host
had tagged, before their views are made, and their components mount new ones
([0104](../decisions/0104-a-components-android-root-may-be-a-fragment.md)).
`LucentFragments` is in `src/fragment/java`, built only for a program with such
a component, against the app's androidx.fragment, and by every deferred Android
build, which can't know.

## The JavaScript proxy

Each module's proxy exports its components as data (`ui/proxy.ts`). The views
runtime, `js/_lucent/views.js`, makes each a React component with the app's
React and React Native, which the proxy passes in. It gets the host component
from `NativeComponentRegistry.get`, sends commands through
`codegenNativeCommands`, and gives the ref the host view with the commands
assigned to it, through `useImperativeHandle`.

| What React gives the component        | What reaches the native view                         |
| ------------------------------------- | ---------------------------------------------------- |
| `style`                               | `style`, React Native's own                          |
| A declared prop                       | `p<index>`, `undefined` left out, nullables boxed    |
| A declared event's callback           | `e<slot>`, an adapter spreading the payload's `args` |
| `children`, declared `Children`       | React Native's children of the host view             |
| `children`, not declared              | Nothing, and one `console.error`                     |
| `ref`                                 | Nothing: React's ref is the host view, with commands |
| Anything else (`testID`, `onLayout`…) | As it is, as to a `View`                             |

Only props React was given count, so a prop named like an inherited member
(`toString`) reads as given or not. A command's extra arguments are dropped, and
an unmount rejects the mount's pending requests. In JS dev mode
([0060](../decisions/0060-js-dev-mode-runs-modules-as-javascript.md)),
`.lucent.tsx` modules stay native.

## Threading

| Work                                                                       | Thread                                   | Waits for        |
| -------------------------------------------------------------------------- | ---------------------------------------- | ---------------- |
| Setup, effects, commands, disposal, the callbacks setup gives the platform | Main, in the main context                | Nothing          |
| `Mount::update` called off the main thread                                 | Posted to the main context (`PropInbox`) | Nothing          |
| The shadow tree: props, measure, layout                                    | React Native's renderer threads          | Nothing          |
| Event payloads, request answers, state updates                             | The JavaScript thread                    | Nothing          |
| Module code (exports, module callbacks)                                    | Its package's actor                      | The actor's lock |

Every entry point of a mount runs on the main thread, and enters the main
context itself (`ContextEntry`). So a host calls it from UIKit or the main
looper as it is. The main context never takes a package's lock. Commits posted
from any thread coalesce until the main context applies them in one transaction;
a command or a measurement drains them first.

### UI isolation

Module state is its module's actor's, so setup code can't use it, even through a
module function it calls (LUCENT3022). The exception is state only main-thread
code uses: components and `main()` callbacks (`analysis/main-state.ts`,
[0046](../decisions/0046-ports-keep-their-apis-views-share-state-the-main.md)).
It holds plain values or native objects, used through a collection's members, so
no reference to it reaches an actor's thread.

A SwiftUI or Compose body is Swift or Kotlin, but what the setup computes for it
is setup code to these checks: each value it shows that reads the setup's names,
what a helper view computes where it is used, and what a callback passes to the
function it calls (`bodySlots` in `analysis/local.ts`). A list's item and a
callback's argument count as the setup's names; the toolkit's and the body's own
(a composition value, a toolkit's scope) are left out.

When UIKit or Android calls module code on the main thread (an override, a
callback module code registered), that code needs its actor. The main thread
never queues: it waits only for the holder in place
([0064](../decisions/0064-an-actor-per-package-and-the-main-thread-never-queues.md)).
A setup's own callbacks run in the main context. The hosts' few mutexes (the
Android registries, the request connections, each prop inbox) are never held
across a call into Lucent or React code.

## Debugging

- **Snapshot.** A debug build's `__lucentDebug.snapshot()` resolves with live
  counts: effects, signals, computed values, scopes, native references. It lists
  each live mount with its component's id, its setup's source line and its
  views' tree, each view's class and frame (`platform/ios_debug.mm`,
  [tracing.md](../tracing.md)).
- **Sizing trace.** `LUCENT_SIZING_TRACE=1`, or Android's `debug.lucent.sizing`
  property set to `1`, logs `LUCENT_SIZING` lines: each mount's requests,
  measurements, verdicts and slot reports.
- **Logs and spans.** The hosts log `[lucent]` lines: children a component
  doesn't take, a slot left out, a missing event emitter, no compiled code. Each
  effect run is a trace span, `effect`, at its `effect()` call's line.

## Limits

The view gate closes these gaps ([parity.md](../parity.md#views)):

| Gap                                                                                           | Task                     |
| --------------------------------------------------------------------------------------------- | ------------------------ |
| An `AVPlayerViewController` spike, run on the simulator                                       | [T122](../tasks.md#t122) |
| Helpers with lists of their own in SwiftUI and Compose bodies                                 | [T123](../tasks.md#t123) |
| A component's view in module code, run on the simulator and the emulator                      | [T124](../tasks.md#t124) |
| Views made after setup on Android keep the hosting view's themed context, run on the emulator | [T125](../tasks.md#t125) |

Accepted, with no task ([limitations.md](../limitations.md#views)):

- Android pools component views only when the app turns on
  `enableViewRecycling`; iOS always does.
- A component shows its previous size, zero at mount, for at least one layout
  after each change. Sizes and slot places wait for the JavaScript thread.
- A native change no code of the mount makes keeps the old size on iOS, and on
  Android when it asks for no layout. A looser bound measures again, and locale
  isn't an input of a measurement.
- Android's shell doesn't draw React Native's borders.
- A slot inside a native scroll view doesn't scroll with it, transforms between
  the host and a slot are ignored, and `removeClippedSubviews` doesn't apply to
  slots.
- Android mounts each commit, unless the app turns on
  `enableAccumulatedUpdatesInRawPropsAndroid`.
- A `Flex` inside a stack view sized by Auto Layout has no intrinsic size.
- Native-view rules read declarations, not behavior: Android's `AdapterView`
  declares `addView(View, int)` and throws from it. A list's item is one
  element, and a root chosen by a runtime condition is chosen once per mount.
- Where a platform's SDK is missing, its code is untyped and unchecked.
- SwiftUI: a member newer than the app's oldest iOS (15.1, or its deployment
  target) is LUCENT3024, since a body checks no availability. A static value
  named like a method (`Animation.easeInOut`) is left out, and only closed
  ranges are mapped. `Int(x)` traps on NaN, and a two-value `onChange` doesn't
  type-check.
- Compose: class names that clash keep the first package's.
