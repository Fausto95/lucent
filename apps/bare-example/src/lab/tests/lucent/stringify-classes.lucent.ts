// JSON.stringify of class instances: every own enumerable field, whatever
// its TypeScript visibility, in creation order; never #private fields,
// statics, methods or accessors.

class Account {
  static opened = 0;
  owner: string;
  private balance: number;
  protected limit = 100;
  #pin = 1234;
  note: string | undefined = undefined;

  constructor(
    owner: string,
    balance: number,
    private readonly currency: string,
  ) {
    this.owner = owner;
    this.balance = balance;
    Account.opened++;
  }

  get rich(): boolean {
    return this.balance > 1000;
  }

  pin(): number {
    return this.#pin;
  }

  annotate(note: string): void {
    this.note = note;
  }
}

class Savings extends Account {
  private rate = 0.02;
  tags: string[] = [];

  constructor(
    owner: string,
    private years: number,
  ) {
    super(owner, 50, "EUR");
  }
}

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}

  toJSON(): string {
    return `${this.x},${this.y}`;
  }
}

class Shape {
  private origin = new Point(1, 2);
  constructor(protected label: string) {}
}

class Circle extends Shape {
  #area = 0;
  constructor(private r: number) {
    super("circle");
    this.#area = r * r;
  }
  area(): number {
    return this.#area;
  }
}

export function account(): string {
  const a = new Account("ana", 10, "USD");
  const before = JSON.stringify(a);
  a.annotate("vip");
  return `${before} ${JSON.stringify(a)} ${a.pin()} ${a.rich}`;
}

export function inherited(): string {
  return JSON.stringify(new Savings("bo", 3));
}

export function throughBase(): string {
  const shapes: Shape[] = [new Shape("dot"), new Circle(2)];
  const one: Shape = new Circle(3);
  return `${JSON.stringify(shapes)} ${JSON.stringify(one)}`;
}

export function nested(): string {
  return JSON.stringify({ at: new Point(3, 4), all: [new Point(5, 6)] });
}

class Plain {
  private a = 1;
}

class Plainer extends Plain {
  b = 2;
}

abstract class Kind {
  abstract key: string;
  declare tag: number;
  count = 0;
}

class Keyed extends Kind {
  key = "k";
}

class Box<T> {
  constructor(private item: T) {}
}

class NumberBox extends Box<number> {
  full = true;
  constructor() {
    super(5);
  }
}

class CodedError extends Error {
  code = 7;
}

export function shapes(): string {
  const plain: Plain[] = [new Plain(), new Plainer()];
  const kind: Kind = new Keyed();
  return [plain, kind, new NumberBox(), new CodedError("m")]
    .map((x) => JSON.stringify(x))
    .join(" ");
}
