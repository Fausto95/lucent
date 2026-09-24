import type { Block } from "../../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "A class instance is a shared, reference-counted native object. Assigning it aliases it, as in JavaScript. An exported class can be constructed from JavaScript with `new`, and the same native object always maps to the same JavaScript object (see [Class identity](/docs/boundary/identity/)).",
    },
    { kind: "h2", text: "Members" },
    {
      kind: "code",
      filename: "counter.lucent.ts",
      code: `export class Counter {
  static created = 0;
  readonly label: string;
  #count: number;

  constructor(start: number, label: string = "counter") {
    this.#count = start;
    this.label = label;
    Counter.created++;
  }

  increment(by: number = 1): this {
    this.#count += by;
    return this;
  }

  get value(): number {
    return this.#count;
  }

  set value(v: number) {
    this.#count = Math.max(0, v);
  }

  static total(): number {
    return Counter.created;
  }
}

export class Account {
  private history: number[] = [];

  constructor(readonly owner: string) {}

  deposit(n: number): void {
    if (n <= 0) throw new RangeError("deposit must be positive");
    this.history.push(n);
  }

  get balance(): number {
    return this.history.reduce((a, b) => a + b, 0);
  }
}`,
    },
    {
      kind: "p",
      text: "Supported: fields with initializers, constructors with default parameters, parameter properties (`constructor(readonly owner: string)`), methods, `get`/`set` accessors, static fields and methods, `private`/`protected`/`readonly`, `#private` fields and methods, and returning `this`. Static initialization blocks (`static { … }`) are not supported.",
    },
    { kind: "h2", text: "Inheritance" },
    {
      kind: "p",
      text: "A class can extend another Lucent class. Methods and accessors dispatch virtually, `super(...)` and `super.method()` work, and `instanceof` narrows as in TypeScript. Abstract classes and abstract methods are supported.",
    },
    {
      kind: "code",
      filename: "animals.lucent.ts",
      code: `export abstract class Animal {
  constructor(public name: string) {}
  abstract sound(): string;
  speak(): string {
    return \`\${this.name} says \${this.sound()}\`;
  }
}

export class Dog extends Animal {
  tricks: string[] = [];
  sound(): string {
    return "woof";
  }
  learn(trick: string): Dog {
    this.tricks.push(trick);
    return this;
  }
}

export class Puppy extends Dog {
  override speak(): string {
    return \`\${super.speak()}!\`;
  }
}

export function describe(a: Animal): string {
  if (a instanceof Dog) return \`\${a.speak()} (knows \${a.tricks.length} tricks)\`;
  return a.speak();
}`,
    },
    {
      kind: "p",
      text: "An override must keep the native signature of the member it overrides: the same parameter and return types, and no extra optional parameters. TypeScript allows narrowing a return type (`number` for `number | undefined`); Lucent does not.",
    },
    {
      kind: "code",
      filename: "narrowed.lucent.ts",
      expect: "LUCENT1005",
      code: `class Base {
  find(): number | undefined {
    return undefined;
  }
}

class Always extends Base {
  override find(): number {
    return 1;
  }
}

export function found(): number {
  return new Always().find();
}`,
    },
    {
      kind: "p",
      text: "Classes can only extend Lucent classes and `Error` (see [Errors](/docs/language/errors/)), not built-ins like `Map` or `Array`. One small deviation: a subclass field read from the base constructor holds the type's default instead of `undefined` (see [Differences](/docs/language/differences/)).",
    },
    { kind: "h2", text: "Interfaces" },
    {
      kind: "p",
      text: "An interface with only fields is an object type, and object literals of the same shape satisfy it. An interface with methods, or one named in a class's `implements` clause, is different: it is **nominal**. Only classes that declare `implements` can be used as that interface, and an object literal cannot.",
    },
    {
      kind: "code",
      filename: "shapes.lucent.ts",
      code: `export interface Shape {
  readonly kind: string;
  area(): number;
}

export class Circle implements Shape {
  readonly kind = "circle";
  constructor(private r: number) {}
  area(): number {
    return Math.PI * this.r * this.r;
  }
}

export class Rect implements Shape {
  constructor(
    private w: number,
    private h: number,
  ) {}
  get kind(): string {
    return "rect";
  }
  area(): number {
    return this.w * this.h;
  }
}

export function totalArea(shapes: Shape[]): number {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}`,
    },
    {
      kind: "p",
      text: "A class that has the right members but does not say `implements Shape` is rejected:",
    },
    {
      kind: "code",
      filename: "square.lucent.ts",
      expect: "LUCENT2008",
      code: `interface Shape {
  area(): number;
}

class Square {
  constructor(private side: number) {}
  area(): number {
    return this.side * this.side;
  }
}

export function area(): number {
  const s: Shape = new Square(2);
  return s.area();
}`,
    },
    {
      kind: "list",
      items: [
        "Each implementing member must have the same native signature as the interface member (`LUCENT2009`). A field can implement a `readonly` property, and so can a getter.",
        "Interfaces can extend other interfaces and can be generic (`Feed<T>`). Optional and generic methods cannot be dispatched through an interface yet.",
        "From JavaScript, an interface parameter only accepts instances of Lucent classes that implement it; plain JS objects are rejected with a `TypeError`.",
      ],
    },
];
