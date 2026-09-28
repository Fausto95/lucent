// Generators without a yield: calling one runs nothing, and its body runs
// on the first next(), throwing then if it throws.

let log: string[] = [];

// oxlint-disable-next-line require-yield -- what a generator without a yield does is the case
function* throwing(): Generator<number> {
  log.push("started");
  throw new Error("generator");
}

function* empty(): Generator<number> {}

// oxlint-disable-next-line require-yield -- as above
function* working(): Generator<number> {
  log.push("worked");
}

function drain(start: () => Generator<number>): string {
  log = [];

  let it: Generator<number>;

  try {
    it = start();
    log.push("called");
  } catch (e) {
    return `threw ${(e as Error).message} [${log.join(",")}]`;
  }

  try {
    const items: number[] = [];

    for (const n of it) items.push(n);

    return `done ${items.length} [${log.join(",")}]`;
  } catch (e) {
    return `failed ${(e as Error).message} [${log.join(",")}]`;
  }
}

export function generators(): string {
  return [drain(throwing), drain(empty), drain(working)].join(" | ");
}
