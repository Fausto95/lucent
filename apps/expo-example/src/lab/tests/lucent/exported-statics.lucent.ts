export class Registry {
  static count = 0;
  static label = "registry";
  static readonly limit: number = 3;
  static names: string[] = [];

  readonly seen = Registry.count;

  static add(name: string): number {
    Registry.names.push(name);
    Registry.count += 1;
    return Registry.count;
  }

  static summary(): string {
    return `${Registry.label}: ${Registry.count}/${Registry.limit} ${Registry.names.join(",")}`;
  }
}

export class Scoped extends Registry {
  static scope = "inner";

  static where(): string {
    return `${Scoped.scope} of ${Registry.label}`;
  }
}

export function read(): string {
  return `${Registry.label} ${Registry.count}`;
}
