// A module the bare app's own Swift and Kotlin call at launch, through the
// APIs Lucent generates for native code (T114): AppDelegate.swift calls
// `Callers.Tally` and `Callers.note`, MainApplication.kt
// `dev.lucent.app.callers.Tally` and `note`. The Platform screen reads what
// they did.
const notes: string[] = [];

/** A count the app keeps: the instance it holds keeps the module's state too. */
export class Tally {
  total = 0;

  constructor(public from: string) {
    notes.push(`${from} made a Tally`);
  }

  add(n: number): number {
    this.total += n;
    notes.push(`${this.from} added ${n}, total ${this.total}`);
    return this.total;
  }
}

export function note(text: string): void {
  notes.push(text);
}

/** What native code did with the module, in order. */
export function heard(): string {
  return notes.join("; ");
}
