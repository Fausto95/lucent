// Optional calls of methods and functions that return nothing: as
// statements, and as values (undefined when called or short-circuited).

class Log {
  lines: string[] = [];
  child?: Log;
  onAdd?: (line: string) => void;

  add(line: string): void {
    this.lines.push(line);
    this.onAdd?.(line);
  }

  self(): Log {
    return this;
  }

  parent(): Log | undefined {
    return this.child === undefined ? undefined : this;
  }
}

function maybeLog(present: boolean, log: Log): Log | undefined {
  return present ? log : undefined;
}

export function statements(present: boolean): string {
  const log = new Log();
  const maybe = maybeLog(present, log);

  maybe?.add("statement");
  maybe?.self().add("chained");
  maybe?.self()?.add("chained twice");

  return log.lines.join(",");
}

export function expressions(present: boolean): string {
  const log = new Log();
  const maybe = maybeLog(present, log);

  const a = void maybe?.add("void");
  const b = (maybe?.add("comma"), "after comma");
  const arrow = (): void => maybe?.add("arrow");

  arrow();
  arrow();

  const block = (): void => {
    return maybe?.add("returned");
  };

  block();

  return `${String(a)} ${b} ${log.lines.join(",")}`;
}

export function chains(hasChild: boolean): string {
  const log = new Log();

  if (hasChild) log.child = new Log();

  log.child?.add("child");
  log.parent()?.child?.add("through parent");
  log.parent()?.add("parent");

  const child = log.child;

  return `${log.lines.join(",")} | ${child === undefined ? "no child" : child.lines.join(",")}`;
}

export function callbacks(listen: boolean): string {
  const seen: string[] = [];
  const log = new Log();

  if (listen) log.onAdd = (line) => seen.push(`heard ${line}`);

  log.add("one");

  const notify: ((line: string) => void) | undefined = listen
    ? (line) => seen.push(`notified ${line}`)
    : undefined;

  notify?.("two");

  const discarded = void notify?.("three");

  return `${seen.join(",")} ${String(discarded)}`;
}

export function listens(signal?: AbortSignal): string {
  const seen: string[] = [];

  signal?.addEventListener("abort", () => seen.push("aborted"));

  const controller = new AbortController();
  const own: AbortSignal | undefined = signal === undefined ? undefined : controller.signal;

  own?.addEventListener("abort", () => seen.push("own aborted"));
  controller.abort();

  return seen.length === 0 ? "nothing heard" : seen.join(",");
}

// Calls whose callee is asserted present (`!`), as a member an interface
// may leave out is called: the call it asserts, with the same receiver.
export function asserted(): string {
  const log = new Log();
  const heard: string[] = [];
  log.onAdd = (line) => heard.push(line);

  log.onAdd!("asserted");
  log.self().add!("method");
  maybeLog(true, log)!.add("receiver");

  return `${heard.join(",")} | ${log.lines.join(",")}`;
}
