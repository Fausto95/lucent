// Promise.race settles as the first input settles, Promise.any as the first
// to fulfil (an AggregateError of every reason once all reject), and
// Promise.allSettled with every input's outcome: each in the microtask
// JavaScript settles it in, against a ticker's.

/** A promise that settles `ticks` microtasks from now, logging it. */
function after(log: string[], name: string, ticks: number, fails = false): Promise<string> {
  let p = Promise.resolve(0);

  for (let i = 0; i < ticks; i++) p = p.then((n) => n + 1);
  return p.then((n) => {
    log.push(`${name}@${n}`);
    if (fails) throw new Error(name);
    return name;
  });
}

/** Logs t1, t2… one a microtask. */
function ticker(log: string[], n: number): Promise<number> {
  let p = Promise.resolve(0);

  for (let i = 0; i < n; i++)
    p = p.then((k) => {
      log.push(`t${k + 1}`);
      return k + 1;
    });
  return p;
}

export async function race(): Promise<string> {
  const log: string[] = [];
  const t = ticker(log, 6);
  const won = Promise.race([
    after(log, "slow", 3),
    after(log, "fast", 1),
    after(log, "mid", 2),
  ]).then((v) => log.push(`won:${v}`));
  const lost = Promise.race([after(log, "late", 3), after(log, "boom", 1, true)]).catch(
    (e: Error) => log.push(`lost:${e.message}`),
  );
  const mixed = Promise.race([after(log, "text", 2), Promise.resolve(7)]).then((v) =>
    log.push(`mixed:${v}`),
  );
  const list: Promise<string>[] = [after(log, "b", 2), after(log, "a", 1)];
  const listed = Promise.race(list).then((v) => log.push(`listed:${v}`));

  await Promise.all([t, won, lost, mixed, listed]);
  return log.join(" ");
}

export async function any(): Promise<string> {
  const log: string[] = [];
  const t = ticker(log, 5);
  const first = Promise.any([
    after(log, "x", 1, true),
    after(log, "y", 2),
    after(log, "z", 3),
  ]).then((v) => log.push(`any:${v}`));
  const failed = Promise.any([after(log, "e1", 2, true), after(log, "e2", 1, true)]).catch(
    (e: unknown) => {
      if (e instanceof AggregateError) {
        const reasons: string[] = [];

        for (const r of e.errors as Error[]) reasons.push(r.message);
        log.push(`${e.name}(${e.message}):${reasons.join(",")}:${e.errors.length}`);
      }
      return 0;
    },
  );
  const none = Promise.any([] as Promise<number>[]).catch((e: Error) =>
    log.push(`empty:${e instanceof AggregateError}`),
  );
  const mixed = Promise.any([after(log, "m", 2, true), Promise.resolve(true)]).then((v) =>
    log.push(`mixed:${v}`),
  );

  await Promise.all([t, first, failed, none, mixed]);
  return log.join(" ");
}

function outcome(r: PromiseSettledResult<string>): string {
  return r.status === "fulfilled" ? `ok:${r.value}` : `no:${(r.reason as Error).message}`;
}

export async function allSettled(): Promise<string> {
  const log: string[] = [];
  const t = ticker(log, 5);
  const list: Promise<string>[] = [after(log, "good", 1), after(log, "bad", 3, true)];
  const all = Promise.allSettled(list).then((rs) => log.push(`list:${rs.map(outcome).join(",")}`));
  const pair = Promise.allSettled([after(log, "one", 2, true), Promise.resolve(2)]).then(
    ([a, b]) => {
      const first = a.status === "rejected" ? (a.reason as Error).message : a.value;
      const second = b.status === "fulfilled" ? b.value : -1;

      log.push(`pair:${first},${second}`);
    },
  );
  const empty = Promise.allSettled([] as Promise<number>[]).then((rs) =>
    log.push(`empty:${rs.length}`),
  );

  await Promise.all([t, all, pair, empty]);
  return log.join(" ");
}
