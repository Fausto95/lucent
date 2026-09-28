// Async functions whose body only throws, or only returns a call that
// always throws, still return a promise: calling one never throws, and
// the promise rejects.

let log: string[] = [];

function fail(tag: string): never {
  log.push(tag);
  throw new Error(`no ${tag}`);
}

async function thrown(): Promise<string> {
  log.push("thrown");
  throw new Error("thrown");
}

async function returned(): Promise<string> {
  return fail("returned");
}

async function nothing(): Promise<void> {
  throw new Error("nothing");
}

class Service {
  async load(key: string): Promise<number> {
    return fail(`load ${key}`);
  }
}

/** Calls `start`, notes that it returned, then awaits what it returned. */
async function settle<T>(start: () => Promise<T>): Promise<string> {
  log = [];

  let pending: Promise<T>;

  try {
    pending = start();
    log.push("called");
  } catch (e) {
    return `threw ${(e as Error).message} [${log.join(",")}]`;
  }

  try {
    await pending;

    return `resolved [${log.join(",")}]`;
  } catch (e) {
    return `rejected ${(e as Error).message} [${log.join(",")}]`;
  }
}

export async function functions(): Promise<string> {
  const results = [
    await settle(thrown),
    await settle(returned),
    await settle(nothing),
    await settle(() => new Service().load("key")),
  ];

  return results.join(" | ");
}

export async function arrows(): Promise<string> {
  const block = async (): Promise<string> => {
    throw new Error("block");
  };
  const expression = async (): Promise<number> => fail("expression");
  const statement = async (): Promise<void> => {
    fail("statement");
  };

  return [await settle(block), await settle(expression), await settle(statement)].join(" | ");
}

export async function exported(): Promise<string> {
  return fail("exported");
}
