// `void | undefined`: what an optional call of a method returning nothing
// gives, unannotated arrows returning one, and functions declared so.

class Log {
  lines: string[] = [];

  add(line: string): void {
    this.lines.push(line);
  }
}

function maybeLog(present: boolean, log: Log): Log | undefined {
  return present ? log : undefined;
}

function finish(log: Log, early: boolean): void | undefined {
  if (early) return undefined;

  log.add("finished");
}

function run(step: () => void | undefined): string {
  return String(step());
}

export function arrows(present: boolean): string {
  const log = new Log();
  const maybe = maybeLog(present, log);
  const add = () => maybe?.add("arrow");
  const result = add();

  return `${String(result)} ${run(() => maybe?.add("callback"))} ${log.lines.join(",")}`;
}

export function declared(early: boolean): string {
  const log = new Log();
  const result = finish(log, early);

  return `${String(result)} ${typeof result} ${log.lines.join(",")}`;
}

export function kept(present: boolean): string {
  const log = new Log();
  const result = maybeLog(present, log)?.add("kept");

  return `${String(result)} ${result === undefined} ${log.lines.join(",")}`;
}
