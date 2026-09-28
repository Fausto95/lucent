// Switches whose clauses all return: nothing runs after them, so the
// function needs no return of its own.

/** Every clause returns, the default last. */
export function size(n: number): string {
  switch (n) {
    case 0:
      return "none";
    case 1:
      return "one";
    case 2:
      return "two";
    default:
      return "many";
  }
}

/** The default in the middle: a value no case matches starts there. */
export function rank(n: number): string {
  switch (n) {
    case 1:
      return "gold";
    default:
      return "other";
    case 2:
      return "silver";
  }
}

/** Clauses that fall through to one that returns. */
export function weekday(day: string): boolean {
  switch (day) {
    case "sat":
    case "sun":
      return false;
    case "mon":
    default:
      return true;
  }
}

/** The default falls through to the last case. */
export function steps(n: number): number {
  let count = 0;

  switch (n) {
    default:
      count++;
    // falls through
    case 3:
      count += 3;
      return count;
  }
}

/** Every member of the union has a case: there is no default. */
export function weight(kind: "light" | "heavy"): number {
  switch (kind) {
    case "light":
      return 1;
    case "heavy":
      return 10;
  }
}

/** A value computed through a conditional first. */
export function sign(x: number): string {
  const s = x > 0 ? 1 : x < 0 ? -1 : 0;

  switch (s) {
    case 1:
      return "+";
    case -1:
      return "-";
    default:
      return "0";
  }
}
