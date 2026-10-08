export async function greet(name: string, times: number): Promise<string> {
  return `${name} `.repeat(times).trim();
}

export class Greeter {
  constructor(readonly greeting: string) {}

  async greet(name: string): Promise<string> {
    return `${this.greeting} ${name}`;
  }
}

export function greetNow(name: string): string {
  return `hello ${name}`;
}
