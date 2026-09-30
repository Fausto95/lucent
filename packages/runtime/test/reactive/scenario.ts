/**
 * The scenario language both the reference (here) and the runtime
 * (reactive_test.cpp) run, and the log they must agree on.
 *
 * A scenario is one step per line, tokens separated by spaces, bodies in
 * `[ … ]`:
 *
 *   signal ID NUM          a signal
 *   computed ID BODY       a computed value: BODY's sum
 *   mount ID               a scope, as a view mount's
 *   effect ID MOUNT BODY   an effect made in the mount
 *   cleanup MOUNT TAG      a cleanup of the mount itself
 *   write ID NUM           sets a signal
 *   begin … commit         a transaction around the steps between
 *   read ID                reads a signal or computed value, untracked
 *   unmount ID             disposes the mount, in a transaction
 *   dispose ID             disposes the effect ID last made
 *   complete ID            completes the task ID last started (none: logs so)
 *
 * A body adds up what it reads:
 *
 *   read ID | peek ID      adds the value, tracked | untracked
 *   add NUM                adds NUM
 *   if ID NUM BODY BODY    the first body if ID (read, tracked) < NUM, else the second
 *   write ID NUM | set ID NUM   sets ID to (the sum + NUM) % 1000 | to NUM
 *   cleanup TAG | cleanupthrow TAG | cleanupset ID NUM | cleanupread ID
 *                          registers a cleanup: logs; logs and throws; sets ID; logs ID's value
 *   effect ID BODY         a nested effect
 *   task ID BODY           starts a task in the run's scope; BODY continues it when completed
 *                          (logging what it throws)
 *   throw TAG              throws an Error with message TAG
 *
 * Numbers are JavaScript's (NaN, -0 included).
 */
import { Graph, Scope, type Task, type Where } from "./reference.ts";

export const LOOP_LIMIT = 20;

type Tokens = string[];

/** The tokens of one line, and the bodies in brackets as nested lists. */
export function tokenize(line: string): Tokens {
  return line.trim().split(/\s+/).filter(Boolean);
}

export function formatNumber(v: number): string {
  return Object.is(v, -0) ? "-0" : String(v);
}

function parseNumber(s: string): number {
  return s === "NaN" ? NaN : Number(s);
}

/** The body starting at `at` (a "["), and where it ends. */
function body(tokens: Tokens, at: number): { body: Tokens; end: number } {
  if (tokens[at] !== "[") throw new Error(`expected [ at ${at} in ${tokens.join(" ")}`);

  let depth = 0;
  for (let i = at; i < tokens.length; i++) {
    if (tokens[i] === "[") depth++;
    if (tokens[i] === "]" && --depth === 0) return { body: tokens.slice(at + 1, i), end: i + 1 };
  }

  throw new Error(`unclosed [ in ${tokens.join(" ")}`);
}

type Readable = { get(): number; peek(): number };
type Writable = Readable & { set(v: number): void };

/** Runs `lines` against the reference and returns the log. */
export function runScenario(lines: string[]): string[] {
  const log: string[] = [];

  const graph = new Graph({
    loopLimit: LOOP_LIMIT,
    onError: (errors: Error[], where: Where) =>
      log.push(`error ${where} ${errors.map((e) => e.message).join("|")}`),
  });

  const signals = new Map<string, Writable>();
  const computeds = new Map<string, Readable>();
  const mounts = new Map<string, Scope>();
  const effects = new Map<string, { dispose(): void }>();
  const tasks = new Map<string, Task>();

  const readable = (id: string): Readable => {
    const r = signals.get(id) ?? computeds.get(id);
    if (!r) throw new Error(`no signal or computed ${id}`);
    return r;
  };

  const signal = (id: string): Writable => {
    const s = signals.get(id);
    if (!s) throw new Error(`no signal ${id}`);
    return s;
  };

  /** Runs `b` for `label`; the sum it read. */
  const exec = (label: string, b: Tokens): number => {
    let sum = 0;
    let i = 0;

    while (i < b.length) {
      const op = b[i]!;

      switch (op) {
        case "read":
          sum += readable(b[i + 1]!).get();
          i += 2;
          break;
        case "peek":
          sum += readable(b[i + 1]!).peek();
          i += 2;
          break;
        case "add":
          sum += parseNumber(b[i + 1]!);
          i += 2;
          break;
        case "if": {
          const v = readable(b[i + 1]!).get();
          const k = parseNumber(b[i + 2]!);
          const yes = body(b, i + 3);
          const no = body(b, yes.end);
          sum += exec(label, v < k ? yes.body : no.body);
          i = no.end;
          break;
        }
        case "write":
          // Bounded, so a loop's values stay integers every number format agrees on.
          signal(b[i + 1]!).set((sum + parseNumber(b[i + 2]!)) % 1000);
          i += 3;
          break;
        case "set":
          signal(b[i + 1]!).set(parseNumber(b[i + 2]!));
          i += 3;
          break;
        case "cleanup": {
          const tag = b[i + 1]!;
          graph.onCleanup(() => log.push(`cleanup ${label} ${tag}`));
          i += 2;
          break;
        }
        case "cleanupthrow": {
          const tag = b[i + 1]!;
          graph.onCleanup(() => {
            log.push(`cleanup ${label} ${tag}`);
            throw new Error(tag);
          });
          i += 2;
          break;
        }
        case "cleanupset": {
          const target = signal(b[i + 1]!);
          const v = parseNumber(b[i + 2]!);
          graph.onCleanup(() => target.set(v));
          i += 3;
          break;
        }
        case "cleanupread": {
          const source = readable(b[i + 1]!);
          const id = b[i + 1]!;
          graph.onCleanup(() =>
            log.push(`cleanup ${label} read ${id} = ${formatNumber(source.get())}`),
          );
          i += 2;
          break;
        }
        case "effect": {
          const id = b[i + 1]!;
          const inner = body(b, i + 2);
          makeEffect(id, inner.body);
          i = inner.end;
          break;
        }
        case "task": {
          const id = b[i + 1]!;
          const then = body(b, i + 2);
          tasks.set(
            id,
            graph.scope().startTask((outcome) => {
              if (outcome === "cancelled") return log.push(`task ${id} cancelled`);

              try {
                log.push(`task ${id} done = ${formatNumber(exec(id, then.body))}`);
              } catch (e) {
                log.push(`task ${id} throws ${(e as Error).message}`);
              }
            }),
          );
          i = then.end;
          break;
        }
        case "throw":
          throw new Error(b[i + 1]!);
        default:
          throw new Error(`unknown body step ${op}`);
      }
    }

    return sum;
  };

  const makeEffect = (id: string, b: Tokens) => {
    effects.set(
      id,
      graph.effect(() => {
        const sum = exec(id, b);
        log.push(`run ${id} = ${formatNumber(sum)}`);
      }, id),
    );
  };

  const steps = (list: Tokens[]): void => {
    let i = 0;

    while (i < list.length) {
      const t = list[i]!;

      if (t[0] === "begin") {
        let depth = 0;
        let end = i;
        for (; end < list.length; end++) {
          if (list[end]![0] === "begin") depth++;
          if (list[end]![0] === "commit" && --depth === 0) break;
        }

        graph.transaction(() => steps(list.slice(i + 1, end)));
        i = end + 1;
        continue;
      }

      step(t);
      i++;
    }
  };

  const step = (t: Tokens): void => {
    switch (t[0]) {
      case "signal":
        signals.set(t[1]!, graph.signal(parseNumber(t[2]!)));
        break;
      case "computed": {
        const id = t[1]!;
        const b = body(t, 2).body;
        computeds.set(
          id,
          graph.computed(() => {
            try {
              const sum = exec(id, b);
              log.push(`eval ${id} = ${formatNumber(sum)}`);
              return sum;
            } catch (e) {
              log.push(`eval ${id} throws ${(e as Error).message}`);
              throw e;
            }
          }),
        );
        break;
      }
      case "mount":
        mounts.set(t[1]!, new Scope());
        break;
      case "effect":
        graph.within(mounts.get(t[2]!)!, () => makeEffect(t[1]!, body(t, 3).body));
        break;
      case "cleanup": {
        const [, id, tag] = t;
        graph.within(mounts.get(id!)!, () =>
          graph.onCleanup(() => log.push(`cleanup ${id} ${tag}`)),
        );
        break;
      }
      case "write":
        signal(t[1]!).set(parseNumber(t[2]!));
        break;
      case "read":
        try {
          log.push(`read ${t[1]} = ${formatNumber(readable(t[1]!).peek())}`);
        } catch (e) {
          log.push(`read ${t[1]} throws ${(e as Error).message}`);
        }
        break;
      case "unmount": {
        const errors = graph.transaction(() => mounts.get(t[1]!)!.dispose());
        if (errors.length > 0) log.push(`error unmount ${errors.map((e) => e.message).join("|")}`);
        break;
      }
      case "dispose":
        effects.get(t[1]!)!.dispose();
        break;
      case "complete": {
        const task = tasks.get(t[1]!);
        if (!task) log.push(`task ${t[1]} none`);
        else if (!task.succeed()) log.push(`task ${t[1]} dropped`);
        break;
      }
      default:
        throw new Error(`unknown step ${t.join(" ")}`);
    }
  };

  steps(lines.map(tokenize).filter((t) => t.length > 0));
  return log;
}
