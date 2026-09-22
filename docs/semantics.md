# Lucent semantics

Version: 0.1.0

This document is authoritative for Lucent conformance. Surface syntax lives in
[`docs/language.md`](language.md); the IR contract in [`docs/ir.md`](ir.md).
Unsupported TypeScript constructs produce `LUCENT` diagnostics rather than
inheriting JavaScript behaviour. Where a construct is not yet implemented, this
specification still defines the required semantics; implementations must meet
them before claiming conformance.

## Guarantee classes

Every rule below is tagged:

| Tag          | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| **static**   | Enforced by the compiler; violation is a `LUCENT` diagnostic.           |
| **runtime**  | Checked or observed during native / host execution.                     |
| **contract** | Trusted SDK / adapter metadata; Lucent does not verify the native body. |

Backends emit already-resolved semantics. Hosts (Expo, Nitro) transport values
across the JS boundary; they do not redefine ownership, cancellation, or
resource behaviour.

## Three lifetimes

```text
JS handle lifetime  ≠  native object lifetime  ≠  native resource lifetime
```

- A **JS handle** is an opaque identity in the host registry. `dispose()`
  invalidates every alias of that handle (**runtime**). Disposal does not
  cancel work, call an SDK close method, or free a native resource.
- A **native object** is the Swift/Kotlin instance retained by Lucent (owned
  reference, lease, or capture). Its memory lifetime follows the platform
  retention model under Lucent's ownership rules.
- A **native resource** is an SDK-managed capability (camera session, file
  handle, subscription registration). It has an explicit open/close state
  machine. Closing a resource is distinct from disposing a JS handle and from
  dropping the last native retain.

A lease keeps a native object alive for an accepted call. It neither requests
cancellation nor invokes SDK close (**runtime**, as implemented for async
wrappers and registry leases).

---

## Values

A **value** is copyable data with no native identity: scalars (`bool`, `string`,
sized numerics, `float64`/`number`), `void`, value structs (type aliases),
discriminated unions, `array<T>`, `map<T>`, `bytes` (`Uint8Array`), and
`optional<T>` of values.

| Aspect          | Rule                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation        | Literals, constructors of value types, copies of fields / elements.                                                                                                                                                                           |
| Ownership       | Always owned by the binding that holds them; no borrow mode.                                                                                                                                                                                  |
| Copying         | Structural / bit copy as appropriate for the representation. Arrays and maps are value-copied across the JS boundary; inside native code they follow Swift `Array` / Kotlin `List` sharing (**runtime** + **contract** for host marshalling). |
| Retention       | N/A beyond ordinary stack / register storage.                                                                                                                                                                                                 |
| Transferability | Always transferable across executors and suspension.                                                                                                                                                                                          |
| Executor        | None.                                                                                                                                                                                                                                         |
| Suspension      | Survives `await` unchanged.                                                                                                                                                                                                                   |
| Destruction     | Drop of the last copy; no finalizer.                                                                                                                                                                                                          |

### Numeric overflow

- Default `number` is IEEE 754 binary64 (`float64`). `/` is floating division;
  `%` follows JavaScript `fmod`; string `+` concatenates (**runtime**).
- Sized integers from `@lucent-lang/core/types` wrap on overflow as on the
  target platform (**runtime**).
- Ordinary Lucent arithmetic never converts numeric types implicitly
  (**static**, `LUCENT1011`). Integer literals adopt the sized type of their
  context. Lossless SDK-argument widenings are a separate, enumerated rule
  (**static**); they do not apply inside authored Lucent arithmetic.

### Initialization order

- Struct fields and class instance fields are initialized in declaration order
  before the constructor body runs (**static** shape; **runtime** evaluation).
- View `state(literal)` slots initialize once per host component identity when
  that identity is first created; prop updates do not re-run them (**runtime**).
- Module-level executable statements are rejected (**static**). There is no
  JS-style module side-effect order on the native side.

---

## Native references

A **native reference** names a platform object (SDK type or Lucent-authored
`SharedObject` / class). Manifest / `@NativeReference` contracts use
`NativeObjectContract`:

```text
ownership: owned | external
executor: caller | main | worker | serial
transferable?: boolean   // explicit opt-in; ownership alone never implies it
close?: string           // method that marks the binding closed
```

| Aspect          | Rule                                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation        | `new`, factory binding, or SDK return with `result: owned \| external \| borrowed`.                                                                                                          |
| Ownership       | See owned / borrowed / weak / shared below.                                                                                                                                                  |
| Copying         | Copies the _reference_ (retain), not a deep clone, unless the type is a value.                                                                                                               |
| Retention       | Platform retain/release under the active ownership mode.                                                                                                                                     |
| Transferability | Only when `transferable: true` **and** ownership permits (**static** for async args; **contract** that the type is executor-safe).                                                           |
| Executor        | Object `executor` and call `contract.executor` must match the enclosing function: `main` ↔ `@MainThread`, `worker` ↔ `@Background`; `serial` stays on the caller (**static**, `LUCENT1019`). |
| Suspension      | Non-transferable / borrowed references must not be used after `await` (**static**, `LUCENT1018`).                                                                                            |
| Destruction     | Drop of retains; optional `close` marks the Lucent binding unusable (**static** thereafter). JS `dispose()` ends the handle only.                                                            |

`nativeOnly: true` types never appear in exported JS signatures (**static**).

---

## Owned references

**Owned** (`NativeObjectContract.ownership: "owned"`, or a call result
`result: "owned"`) means Lucent (or the binding that received the result) is
responsible for retaining the object for as long as a live Lucent binding
exists.

| Aspect          | Rule                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| Creation        | Constructor / factory / owned result.                                              |
| Ownership       | Strong retain by each Lucent binding and by `retained` captures.                   |
| Copying         | Alias with independent retain count; all aliases share identity.                   |
| Retention       | Strong until drop, transfer of ownership, or explicit close of a resource wrapper. |
| Transferability | Requires `transferable: true` for async / cross-executor use (**static**).         |
| Executor        | As declared on the object contract.                                                |
| Suspension      | Allowed only if transferable (or the value is not executor-confined).              |
| Destruction     | Last strong retain released; does **not** imply resource `close()`.                |

Lucent-authored `SharedObject` instances are owned native objects with a JS
handle. Synchronous cross-object calls are serialized by a recursive native
lock (**runtime**). Async functions cannot accept Lucent-authored shared-object
arguments (**static**); transferable SDK owned references follow the contract
above.

---

## Borrowed references

**Borrowed** values are temporary views of storage owned elsewhere. They arise
from `result: "borrowed"`, parameters with `ownership: "borrowed"`, or
externally owned native-only parameters (scoped borrows).

| Aspect          | Rule                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation        | Only as a call result or parameter declared borrowed / external-scoped.                                                                                                                                                                                                   |
| Ownership       | No retain that outlives the borrow scope.                                                                                                                                                                                                                                 |
| Copying         | Forbidden as escape: cannot return, store in a record/array, pass to a `retained` parameter, or capture in an escaping closure (**static**, `LUCENT1018`).                                                                                                                |
| Retention       | Valid only for the declared lifetime (call, callback delivery, or annotated scope).                                                                                                                                                                                       |
| Transferability | Never.                                                                                                                                                                                                                                                                    |
| Executor        | Use only on the executor of the delivering call.                                                                                                                                                                                                                          |
| Suspension      | Use after `await` is rejected (**static**, `LUCENT1018`), unless the language later admits an explicit borrow-across-suspension annotation. Copying or promoting to owned storage before suspension is required; merely supporting a copy API does not extend the borrow. |
| Destruction     | End of borrow scope; the underlying owner remains responsible.                                                                                                                                                                                                            |

A callback parameter with `retention: "call"` may capture a borrow for the
duration of that call (**static**). `retention: "subscription"` or unspecified
retention may not.

---

## Weak references

`weak(reference)` produces an optional view of an **owned** native reference.

| Aspect          | Rule                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Creation        | Explicit `weak(ownedRef)` only.                                                                                      |
| Ownership       | Does not keep the referent alive.                                                                                    |
| Copying         | Copies the weak binder; still optional.                                                                              |
| Retention       | Weak; upgrades to strong only while the optional is non-null and in use under normal rules.                          |
| Transferability | Same constraints as reading the referent after upgrade.                                                              |
| Executor        | Same as the referent.                                                                                                |
| Suspension      | The optional may be carried; using a lapsed referent yields `null` (**runtime**). Borrowed values have no weak form. |
| Destruction     | Drop of the weak binder; referent may already be gone.                                                               |

Closures capture `weak(reference)` as `kind: "weak"`; the body must handle
`null` (**static** / typing).

---

## Shared references

The language defines **shared** as a multi-owner strong reference distinct from
exclusive owned transfer: several Lucent bindings may hold the same native
identity with equal retain rights (Lucent-authored `SharedObject`, and future
`shared<T>` surface forms from the ownership roadmap).

| Aspect          | Rule                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation        | Shared construction or explicit share of an owned identity where the type admits sharing.                                                                         |
| Ownership       | Each alias is a strong owner; disposal of one JS handle does not free the native object while other retains exist.                                                |
| Copying         | Alias (retain).                                                                                                                                                   |
| Retention       | Strong per alias.                                                                                                                                                 |
| Transferability | Mutable shared classes remain non-transferable across async / executor hops unless a future contract says otherwise (**static** today for Lucent shared objects). |
| Executor        | Bridge-entry serialization for sync shared-object calls (**runtime**); SDK shared types follow their object executor.                                             |
| Suspension      | Lucent-authored shared objects are rejected as async arguments (**static**).                                                                                      |
| Destruction     | Last strong retain; JS handle disposal is independent.                                                                                                            |

`shared` is not inferred from a class name (**contract** / explicit annotation).

---

## Resources

A **resource** is a native object with an explicit lifecycle beyond memory
retention. The language defines this state machine:

```text
OPEN
  → closing:
       reject new operations
       cancel owned work
       wait for in-flight operations / leases
       cleanup SDK resource
  → CLOSED
```

Operation lifecycle:

```text
validate resource → acquire lease → perform work → release lease
```

| Aspect          | Rule                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Creation        | Factory / constructor that opens the SDK capability.                                                                           |
| Ownership       | Typically `owned` with optional `contract.close`. External SDK resources may be `external` with scoped borrows into callbacks. |
| Copying         | Reference alias; close is per resource identity, not per alias.                                                                |
| Retention       | Object retain ≠ resource open.                                                                                                 |
| Transferability | As on the object contract.                                                                                                     |
| Executor        | As declared; teardown is executor-aware (**contract**).                                                                        |
| Suspension      | Operations may suspend while holding a lease; borrows into those operations still cannot escape.                               |
| Destruction     | `close()` moves toward CLOSED. Idempotent (**runtime**). Handle disposal must **not** imply resource close.                    |

When a reference declares `contract.close`, any later use of that identifier is
rejected, including when only one branch closes it (**static**, `LUCENT1018`
“Cannot use after it was closed”). `await withResource(resource, body)` /
`await withSubscription(subscription, body)` also mark the argument closed after
the call (**static**); native helpers await `close()` on every exit path
(**runtime**). `await resourceScope(body)` marks identifiers passed to
`scope.own(…)` closed after the call; `await scope.closeAll()` does the same for
resources owned on that `ResourceScope` (**static** + **runtime** reverse-order
close).

### Move and copy

| Form      | Rule                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| `move(x)` | Transfers ownership of an owned local; use-after-move is `LUCENT1018`. Borrowed args rejected. |
| `copy(x)` | Explicit owned/value copy for scalars, value structs, and bytes. Native refs need a copy API.  |

IR ops are `move` / `copy`. Backends emit `move` as identity and byte `copy` via
`LucentBytes` (**runtime**).

### Cleanup failure

If SDK cleanup throws or fails:

- The resource must still reach a documented terminal CLOSED (or failed-closed)
  state and must not reopen (**runtime** + **contract**).
- Callers awaiting close observe a single terminal outcome; subsequent
  `close()` remains idempotent.
- Cleanup failure does not resurrect leases or accept new operations.
- Late callbacks after close must be discarded safely while releasing any
  payload ownership they carry (**contract**).

Callback-initiated close must not deadlock: requesting close from inside a
callback is allowed; completion must not synchronously wait on that same
callback (**contract** / runtime design).

`TaskScope` models structured operation tracking across suspension (see
Cancellation and async). It is not itself an SDK resource, but `await
scope.close()` follows the same “reject → cancel → wait for finish” shape
(**runtime**).

---

## Closures

Closures are typed native function values (`NativeCallback`), not JS functions.

IR captures (**static**):

| Kind       | Meaning                                         |
| ---------- | ----------------------------------------------- |
| `value`    | Immutable scalars and value records.            |
| `retained` | Immutable local with owned native contract.     |
| `borrowed` | Borrow closed over by `retention: "call"` only. |
| `weak`     | From `weak(reference)`.                         |

Rejected: mutable locals, external resources, nested callback results, borrowed
captures into `retention: "subscription"` or escaping callbacks without borrow
permission (**static**, `LUCENT1018` / related).

| Aspect          | Rule                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation        | Arrow / function expression with explicit or contextual `NativeCallback` type.                                                                                      |
| Ownership       | The closure retains its captures per kind above.                                                                                                                    |
| Copying         | Function reference copy; same capture environment.                                                                                                                  |
| Retention       | `call` — live only for the invocation; `subscription` — live until subscription close.                                                                              |
| Transferability | Follows capture and callback `executor` metadata.                                                                                                                   |
| Executor        | Callback bodies are checked against `callback.executor` (**static**); adapters must deliver on that executor (**contract**).                                        |
| Suspension      | Closure construction has no suspension; bodies may be async only when the language admits that form. Async function _values_ crossing JS are rejected (**static**). |
| Destruction     | When the retaining call ends or the subscription / delegate owner releases.                                                                                         |

Error policy on callbacks: `propagate` or `notify` / fallback per delegate
schema (**contract**; **runtime** for catch paths). An explicit mutable cell for
captures does not make concurrent mutation safe; require executor confinement,
synchronization, or a supported atomic cell (**static** / **contract**).

---

## Mutation and aliasing

- `const` bindings are immutable; assignment is `LUCENT1016` (**static**).
- `let`, field writes, `++`/`--`, `push`, and compound assignments mutate in
  place (**runtime**).
- Value structs and union payloads are immutable as wholes; replace the value
  to change fields / variants (**static** / representation).
- Native reference aliases share identity: mutation through one alias is
  visible through others (**runtime**).
- Borrowed inputs must not be mutated or detached by the callee in a way that
  invalidates the caller's view during a synchronous call (**contract**).
- Shared-object bridge calls serialize entry (**runtime**); this is not a
  general data-race solver for SDK threads.
- Arrays: JS-boundary copy vs in-native sharing as under Values.

Aliasing of borrows that would outlive the owner is rejected (**static**).

---

## Async

`async` functions declare `Promise<T>` and may `await`. There is no JS promise
scheduler on the native side; backends use Swift `async` / Kotlin `suspend`.

| Rule                                                                                  | Class                                    |
| ------------------------------------------------------------------------------------- | ---------------------------------------- |
| `await` only in `async`                                                               | **static** (`LUCENT1000` / `LUCENT1013`) |
| Borrowed / non-transferable refs unusable after `await`                               | **static** (`LUCENT1018`)                |
| Bytes: sync may borrow in place; async receives a copy                                | **runtime** / host                       |
| Structured concurrency prefers `TaskScope` over detached promises                     | language model                           |
| Child work completes or is cancelled; resources release; errors propagate predictably | see Cancellation                         |

Detached work requires an explicit long-lived owner and cancellation policy.
Cancellation must not release borrowed memory still in use by the SDK
(**contract**).

---

## Cancellation

### `CancellationSource`

From `@lucent-lang/core/cancellation`:

- `cancel()` — idempotent, cross-executor safe (**runtime**).
- `cancelled` — sticky true once requested.
- `throwIfCancelled()` — throws `LucentError` code `CANCELLED`.
- `scope()` — child that cancels with the parent (including if parent already
  cancelled).
- `finish()` — wins once against cancellation; returns false if cancel or a
  prior finish already happened.
- Cooperative: takes effect at checkpoints, not by preempting blocking SDK
  calls (**runtime** + **contract** for adapters).

Disposing the JS handle rejects new access; it does not cancel. Call `cancel()`
before disposal when stop is required. A cancellation request is not proof that
native work completed; keep leases until actual completion or a contractual
acknowledgment (**contract**).

### `TaskScope` / `NativeTask`

From `@lucent-lang/core/tasks`:

- `begin()` / `new NativeTask(scope)` registers work; fails with `CLOSED_SCOPE`
  if the scope is closing (**runtime**).
- `await scope.close()` rejects new work, requests cancel on active tasks, waits
  until every task `finish()`es. Multiple waiters share the terminal outcome.
  Empty scope closes immediately. `closing` stays true once set.
- A cancelled task must still `finish()` before the scope can close.
- Adapters retain each task and call `finish()` on every completion or error
  path (**contract**). Missing `finish()` leaves close pending.

---

## Executors

| Executor | Meaning                                              |
| -------- | ---------------------------------------------------- |
| `caller` | Inherit the caller's context (`@Inherited` default). |
| `main`   | Main actor / `Dispatchers.Main` (`@MainThread`).     |
| `worker` | Background (`@Background`).                          |
| `serial` | Caller-affine serial; cannot hop.                    |

Thread hops require `async` (**static**). Wrong-executor native calls are
`LUCENT1019` (**static**). `LUCENT3002` warns about expensive main-thread work
(**static** warning only). Delivery of SDK callbacks on the declared executor
is a **contract**; Lucent checks metadata, not the SDK body.

Decorators do not make shared mutable state safe.

---

## Errors

- Only `throw new LucentError(code, { message, …metadata })` (**static**).
- Propagation: uncaught native errors surface to JS as `Error` with `code`,
  `message`, and scalar metadata, identically on Expo and Nitro (**runtime**).
- No `try` / `catch` in Lucent source; callers handle at the host or via
  callback error policies (**static** surface).
- Callback / delegate policies: `propagate`, `notify`, or `fallback` with a
  literal (**contract**).
- Non-finite floats in error metadata normalize to null; nested objects/arrays
  rejected (**runtime**).
- Native stacks are not exposed through the envelope.

Cancellation uses code `CANCELLED`. Scope close rejection uses `CLOSED_SCOPE`.

---

## Subscriptions

The language defines a subscription as an **owned native lifetime**, not a bare
callback registration:

- Registration returns an owned subscription / remove handle.
- `close()` / `remove()` is idempotent (**runtime**).
- Delegate retention until teardown completes — even if the SDK stores the
  delegate weakly, Lucent (or the generated owner) must keep a strong owner
  until deregistration and permitted in-flight delivery quiesce (**contract**).
- Reentrant removal and in-flight quiescence are required before close
  completes.
- Captures release when the subscription completes teardown.
- Teardown is executor-aware per the registration contract.
- Event channels (`event<T>()`) snapshot listeners under a lock and deliver
  outside it (**runtime**); app-side `subscribe` / `remove` is the JS face.
  Native-side SDK subscriptions follow resource close semantics above.

Callback parameter metadata uses `retention: "call" | "subscription"`
(**static** for capture rules; full automatic subscription ownership remains
part of the semantic contract adapters must honour).

---

## Components

`.lucent.tsx` components are native views (SwiftUI / Compose), not React
function components on the native side.

| Concern        | Rule                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Host instance identity owns state, and (when present) resource slots, effects, and tasks.                                                                           |
| State          | `state(literal)` once per identity; `set` only from handlers (**static** / **runtime**).                                                                            |
| Render         | Synchronous; no effects, mutation, async, or loops in the render body (**static**).                                                                                 |
| `For`          | Eager rows; `by` supplies stable identity so state moves with the row (**runtime**). Duplicate keys are a programming error (debug report + disambiguation).        |
| Children slots | Lucent-only composition; no React proxy when a `children: NativeView` slot exists.                                                                                  |
| Unmount        | Host tears down the view; adapter-owned state follows adapter lifecycle. Component-owned resource slots close on unmount (language requirement for resource slots). |

Props are values / events / views as documented in `language.md`. Rendering does
not run JS.

---

## Effects

Two related notions:

### Function effects (analysis)

Every function is described by effects such as `async`, `throws`, `native`,
`io`, `executor(…)`, `resourceMutation`. Effects are inferred from bodies and
verified contracts (**static**). A function is not pure merely because it is
synchronous. Unknown native effects conservatively block purity-dependent
transforms. Wrong-thread UI access, unsafe suspension, and invalid resource
access are diagnosed from effects + contracts.

### Component effects

The language defines component-scoped effects:

```text
effect(() => { …; return () => { … cleanup … } }, deps)
effect(async () => { …; return async () => { … cleanup … } }, deps)
```

Required properties: dependency identity, cleanup, executor, cancellation,
integration with resources and task scopes. Cleanup runs before re-run or on
unmount; cleanup failure follows the resource cleanup-failure rules and must
leave effects inactive. Async effects cancel the previous TaskScope and await
cleanup before starting the next generation (**runtime** via backends). Effects
are not allowed in the synchronous render path (**static**).

---

## Native value kinds — summary matrix

| Kind         | Create                  | Own               | Copy       | Retain         | Transfer          | Executor           | Suspend            | Destroy          |
| ------------ | ----------------------- | ----------------- | ---------- | -------------- | ----------------- | ------------------ | ------------------ | ---------------- |
| Value        | literal / op            | self              | deep/bit   | n/a            | yes               | none               | ok                 | drop             |
| Owned ref    | new / owned result      | strong            | alias      | strong         | if `transferable` | object             | if transferable    | last retain      |
| Borrowed ref | param / borrowed result | none              | no escape  | scoped         | no                | caller of delivery | no use after await | end of scope     |
| Weak ref     | `weak(owned)`           | none              | weak alias | weak           | via upgrade       | referent           | optional may move  | drop binder      |
| Shared ref   | shared / SharedObject   | multi strong      | alias      | per alias      | restricted        | object / bridge    | limited            | last retain      |
| Resource     | open factory            | owned + lifecycle | alias      | object vs open | per contract      | per contract       | leases ok          | `close` → CLOSED |
| Closure      | callback expr           | captures          | fn alias   | per retention  | per captures      | callback exec      | body rules         | release owner    |
| Subscription | register                | owned lifetime    | alias      | until quiesce  | n/a               | teardown exec      | n/a                | idempotent close |
| Component    | host mount              | identity          | n/a        | host           | n/a               | main/UI            | n/a                | unmount          |
| Effect       | effect()                | component         | n/a        | deps           | n/a               | declared           | async ok           | cleanup          |

---

## Exit criterion — conformance

A build of Lucent is semantically conforming for version 0.1.0 when both
backends (Swift, Kotlin) and both hosts (Expo, Nitro) share the same positive
and negative cases below. Cases may live as fixtures under `fixtures/` and
host/interop scripts; outcomes must match across targets.

### Positive cases (must accept and behave)

1. Value scalars, structs, arrays, maps, bytes round-trip with documented
   numeric and copy rules.
2. Owned SDK reference: create, method call, retain across sync calls, dispose
   JS handle without implying SDK `close`.
3. Transferable owned async argument with `ownership: "owned"`,
   `transferable: true`, executor-neutral contract.
4. `retention: "call"` callback capturing a borrow for the call only.
5. `weak(owned)` capture becoming `null` after the referent is gone.
6. `CancellationSource`: cancel, child `scope()`, `throwIfCancelled`,
   `finish` race.
7. `TaskScope`: begin, cancel, `finish`, `await close()` with multiple waiters;
   empty scope closes immediately.
8. Close marking: after `contract.close`, further uses of that binding are
   diagnostics.
9. Component `state` persists across prop updates; `For` + `by` preserves row
   identity.
10. `LucentError` envelope identical on Expo and Nitro.

### Negative cases (must diagnose or safely reject)

1. Borrow returned, stored, or passed to retained parameter → `LUCENT1018`.
2. Borrow used after `await` → `LUCENT1018`.
3. Escaping / `retention: "subscription"` callback capturing a borrow →
   `LUCENT1018`.
4. Async Lucent `SharedObject` argument → boundary diagnostic.
5. Async non-transferable / missing `transferable` reference → rejected.
6. Wrong executor vs `@MainThread` / `@Background` → `LUCENT1019`.
7. Use of binding after `close` on any path → `LUCENT1018`.
8. Unsupported syntax / types → dedicated `LUCENT` codes, not silent JS
   semantics.
9. Resource: dispose handle while operations run must not equate to close;
   close during in-flight work waits or fails closed without reopen
   (runtime / contract tests).
10. Cleanup failure leaves terminal closed state; late callbacks discarded.

Conformance artifacts should name the semantic version (`0.1.0`) and list which
cases are implemented versus still required by this specification.
