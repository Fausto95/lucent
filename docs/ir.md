# Lucent IR

The IR is the contract between the compiler and the backends. It is fully typed
and contains no JavaScript-specific constructs; `packages/compiler/src/ir/types.ts`
is the definition and `printIR` gives the text form used in `fixtures/*.ir.txt`.

## Why it is structured, not a CFG

The original design sketched a basic-block CFG. Swift and Kotlin have no `goto`,
so a CFG would have to be re-structured into `if`/`while` before emission, and
nothing in v1 (no optimisations that need dataflow) would pay for that pass.
The IR therefore keeps structured control flow (`if`, `while`, `forEach`,
`break`, `continue`, `return`, `throw`) and an expression tree, while still
lowering away everything that only JavaScript has:

| Source                          | IR                                                   |
| ------------------------------- | ---------------------------------------------------- |
| `let`/`const`, shadowing        | `let %name` / `%name.1`, unique per function         |
| reassigned parameter            | `let %p = (param p)` prologue; params stay immutable |
| `for (init; test; update)`      | `init; while test { body; update }`                  |
| `for (const x of xs)`           | `foreach %x in xs`                                   |
| `a += b`, `i++`                 | `assign %a = (add %a b)`                             |
| `` `a${n}` ``                   | `(concat "a" (str n))`                               |
| `s + t` on strings              | `(concat s t)`                                       |
| `===`, `!==`                    | `eq`, `ne`                                           |
| `x.length`                      | `(length x)` (arrays, strings, bytes)                |
| `map[key]`                      | `(mapget map key)` → `optional<T>`                   |
| narrowed optional               | `(unwrap %x)` inserted by the checker                |
| `throw new LucentError(c, {m})` | `throw "c" m`                                        |
| `xs.push(v)`                    | `push xs v` statement                                |
| `move(x)` / `copy(x)`           | `(move …)` / `(copy …)` ownership ops                |

Assignments, updates and `push` are statements only; using them inside an
expression is `LUCENT1001`. `continue` inside a C-style `for` is `LUCENT1001` in v1
because the update would be skipped.

## Types

Every expression carries a `NativeType` (`packages/compiler/src/types/native-type.ts`).
Backends map types through a lookup table and never see TypeScript names.
Numeric IR ops are typed by their operands: `(add %i 1)` on `int32` is integer
arithmetic; on `float64` it is IEEE double arithmetic. `(index bytes i)` yields
`float64` like `Uint8Array` indexing does in JavaScript.

## Native contracts and closures

`IRModule.targets` carries configured minimum native deployment versions to
hosts. Native reference and function bindings retain their validated manifest
contracts. Selected overload calls already name a concrete function; backends
do not independently choose candidates.

Every `call` node carries `IRCallSemantics`: optional stable `symbolId`,
per-argument and result ownership, effects (`async` / `throws` / `native` /
`executor`), suspension, and cancellation. `validateHIR` checks these
invariants after lowering. Backends print the already-resolved operation; they
must not re-decide ownership or cancellation from the callee string alone.

Each `IRFunction` may carry an optional `effects` record with the same shape,
inferred in lowering from the function's `async` flag and whether its body
contains native calls (`semantics.effects.native`). Text IR prints effects on
the function header when `native` or `async` is set, for example
`fn foo() -> void [native async]`.

A `closure` expression carries concrete typed parameters, an explicit capture
list, and either a typed expression body or a statement block. Captures are
`value` for immutable scalars and value records, `retained` for an immutable
local whose native contract is `owned`, `borrowed` for a borrow closed over by
a `retention: "call"` callback, or `weak` for `weak(reference)`. Mutable and
unknown resource captures are rejected before lowering. A Swift closure is
throwing. Kotlin expression closures are lambdas; statement bodies are
anonymous functions so `return` completes the callback. Closure body effects
are emitted inside the closure, never as effects of constructing it.

A view function may carry `state` slots. Each slot is a literal scalar
initialized once on the host view instance. Reads are `stateRead` and handler
writes are `stateWrite`; both go through the live cell, not a render snapshot.
`resource` slots name an owned create callee and a `close` method; backends and
hosts create once per identity and close on unmount. `effectSlots` hold sync or async setup/cleanup statement lists plus dependency
names. Async slots set `async: true`; backends cancel/join via `LucentTaskScope`
(`LucentEffectRunner`) before replacement or unmount. `ifExpr` chooses between
two typed values, including views. A `For` view is an eager row builder over an
array, keyed by index.

Native package entries carry an `origin` set by the linker to the registered
package specifier. Hosts use it to report conflicting SDK requirements.

A `widen` expression records a proven lossless SDK-argument conversion. Its
`value.type` is the source representation and its own `type` is the destination.
Both backends emit an explicit native numeric conversion; they never infer one
from the receiving parameter. Text IR prints `(widen <destination> <value>)`.

## Optional optimization

When `compile(..., { optimize: true })` is set, Lucent runs a small semantic
optimization pipeline on HIR after `validateHIR` and before backends see the
module. Passes today:

1. Constant folding of numeric `add` / `sub` / `mul` on const operands
2. Dead-branch elimination for `if` / `ifExpr` with boolean const conditions
3. Conservative dead-code elimination of standalone pure const `expr` statements
4. Escape-analysis (log only)
5. Reachability: remove non-exported functions unreachable from exports, events,
   or classOps (including callees reached through views and `functionRef`
   callbacks)

Each pass re-validates; a failed check keeps the prior module. Optimization is
off by default so fixture goldens stay unchanged. Differential tests require
that optimize on/off preserve the same exported function set.

## Source map stub (P35 partial)

When `compile(..., { sourceMap: true })` is set, the result may include a
`sourceMap` object (`lucent.map.json` shape): IR function names mapped to Lucent
byte spans from the typed AST. `lucent build --emit hir` writes
`.lucent/ir/<module>.lucent.map.json` alongside the IR text. This is **not** a
full Swift/Kotlin → Lucent source map; native diagnostics still need the fuller
P35 pipeline.
