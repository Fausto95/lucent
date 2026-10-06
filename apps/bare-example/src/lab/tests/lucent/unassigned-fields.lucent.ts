// Object-typed storage read before anything writes it is undefined in
// JavaScript: using it as an object throws TypeError.
type Opts = { size: number };
type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };

function failure(f: () => string): string {
  try {
    return f();
  } catch (e) {
    return (e as Error).name;
  }
}

class Base {
  seen: string;
  constructor() {
    this.seen = this.describe();
  }
  describe(): string {
    return "base";
  }
}

class WithOpts extends Base {
  opts: Opts = { size: 3 };
  override describe(): string {
    return `${this.opts.size}`;
  }
}

class WithShape extends Base {
  shape: Circle | Square = { kind: "circle", r: 1 };
  override describe(): string {
    return this.shape.kind;
  }
}

class Late {
  opts!: Opts;
}

// oxlint-disable-next-line no-extraneous-class -- a static field is the case
class Statics {
  static o: Opts;
}

let config: Opts;

// Never called: the case reads `config` before anything assigns it.
export function setConfig(size: number): void {
  config = { size };
}

export function baseReadsField(): string {
  return failure(() => new WithOpts().seen);
}

export function baseReadsUnion(): string {
  return failure(() => new WithShape().seen);
}

export function definiteField(): string {
  return failure(() => `${new Late().opts.size}`);
}

export function staticField(): string {
  return failure(() => `${Statics.o.size}`);
}

export function moduleVariable(): string {
  return failure(() => `${config.size}`);
}
