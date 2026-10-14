// iOS has no broadcast receivers.

export function send(): void {}

export function heard(): string {
  return "none";
}

export class Pinger {
  private count = 0;

  constructor(readonly label: string) {}

  ping(): boolean {
    this.count++;
    return false;
  }

  get sent(): number {
    return this.count;
  }
}
