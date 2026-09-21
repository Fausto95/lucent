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

Assignments, updates and `push` are statements only; using them inside an
expression is `NT1001`. `continue` inside a C-style `for` is `NT1001` in v1
because the update would be skipped.

## Types

Every expression carries a `NativeType` (`packages/compiler/src/types/native-type.ts`).
Backends map types through a lookup table and never see TypeScript names.
Numeric IR ops are typed by their operands: `(add %i 1)` on `int32` is integer
arithmetic; on `float64` it is IEEE double arithmetic. `(index bytes i)` yields
`float64` like `Uint8Array` indexing does in JavaScript.
