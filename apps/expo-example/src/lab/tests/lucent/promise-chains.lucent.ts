// then, catch and finally settle in JavaScript's microtask order: each
// handler in its promise's reaction, a returned promise adopted two
// microtasks later, finally's outcome after its handler's.

/** Two chains, one adopting a promise and one a value, interleaved with their ticks. */
export function interleaved(): Promise<string> {
  const log: string[] = [];
  const a = Promise.resolve(1)
    .then((v) => {
      log.push(`a1:${v}`);
      return Promise.resolve(v + 1);
    })
    .then((v) => {
      log.push(`a2:${v}`);
      return v;
    });
  const b = Promise.resolve(10)
    .then((v) => {
      log.push(`b1:${v}`);
      return v + 1;
    })
    .then((v) => {
      log.push(`b2:${v}`);
      return v + 1;
    })
    .then((v) => {
      log.push(`b3:${v}`);
      return v;
    })
    .then((v) => {
      log.push(`b4:${v}`);
      return v;
    });
  log.push("sync");

  return Promise.all([a, b]).then(([x, y]) => `${log.join(" ")} = ${x},${y}`);
}

/** A rejection passes the fulfilment handlers by, to the first catch; finally sees both. */
export function rejections(): Promise<string> {
  const log: string[] = [];

  return Promise.reject(new Error("boom"))
    .then((v: number) => {
      log.push("skipped");
      return v;
    })
    .catch((e: Error) => {
      log.push(`caught ${e.message}`);
      return 7;
    })
    .finally(() => log.push("finally"))
    .then((v) => {
      log.push(`then ${v}`);
      throw new Error("again");
    })
    .then(
      () => 0,
      (e: Error) => {
        log.push(`second ${e.message}`);
        return 8;
      },
    )
    .then((v) => `${log.join(", ")} -> ${v}`);
}

/** finally's ticks against a plain chain's, and a finally that returns a promise. */
export function finallyOrder(): Promise<string> {
  const log: string[] = [];
  const f = Promise.resolve("f")
    .finally(() => log.push("f-handler"))
    .then((v) => log.push(`f-done:${v}`));
  const g = Promise.resolve("g")
    .finally(() => Promise.resolve().then(() => log.push("g-inner")))
    .then((v) => log.push(`g-done:${v}`));
  const t = Promise.resolve(0)
    .then(() => log.push("t1"))
    .then(() => log.push("t2"))
    .then(() => log.push("t3"))
    .then(() => log.push("t4"))
    .then(() => log.push("t5"));

  return Promise.all([f, g, t]).then(() => log.join(" "));
}
