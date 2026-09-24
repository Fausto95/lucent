export class Animal {
  static count = 0;
  protected sound = "...";
  constructor(public name: string) {
    Animal.count++;
  }
  speak(): string {
    return `${this.name} says ${this.sound}`;
  }
  describe(): string {
    return `${this.kind()}: ${this.speak()}`;
  }
  kind(): string {
    return "animal";
  }
  get legs(): number {
    return 4;
  }
  static named(name: string): Animal {
    return new Animal(name);
  }
}

export class Dog extends Animal {
  tricks: string[] = [];
  constructor(
    name: string,
    private breed: string,
  ) {
    super(name);
    this.sound = "woof";
  }
  override kind(): string {
    return `dog(${this.breed})`;
  }
  learn(trick: string): Dog {
    this.tricks.push(trick);
    return this;
  }
}

export class Puppy extends Dog {
  override speak(): string {
    return `${super.speak()}!`;
  }
  override kind(): string {
    return `puppy of ${super.kind()}`;
  }
}

export class Bird extends Animal {
  song = "tweet";
  constructor(name: string) {
    super(name);
    this.sound = this.song;
  }
  override get legs(): number {
    return 2;
  }
}

abstract class Shape {
  abstract area(): number;
  describe(): string {
    return `area ${this.area().toFixed(1)}`;
  }
}

class Square extends Shape {
  constructor(private side: number) {
    super();
  }
  area(): number {
    return this.side * this.side;
  }
}

class Circle extends Shape {
  area(): number {
    return 3.14159;
  }
}

export function shapes(): string {
  const all: Shape[] = [new Square(2), new Circle()];
  return all.map((s) => s.describe()).join(", ");
}

export function zoo(): string {
  const all: Animal[] = [
    new Animal("generic"),
    new Dog("rex", "lab"),
    new Puppy("bit", "pug"),
    new Bird("tweety"),
    Animal.named("x"),
  ];
  return all.map((a) => `${a.describe()} legs=${a.legs} dog=${a instanceof Dog}`).join(" | ");
}

export function tricks(d: Dog): string {
  return d.learn("sit").learn("roll").tricks.join(",");
}

export function narrow(a: Animal): string {
  if (a instanceof Dog) return `${a.learn("x").tricks.length}`;
  return "not a dog";
}

export function counted(): number {
  return Animal.count;
}

export function makePuppy(): Animal {
  return new Puppy("pip", "beagle");
}

export interface Pet {
  name: string;
  speak(): string;
}

export class Cat extends Animal implements Pet {
  override speak(): string {
    return `${this.name} purrs`;
  }
}

export class Kitten extends Cat {
  override speak(): string {
    return `${super.speak()} softly`;
  }
}

export class Lion extends Animal implements Pet {}

export function pets(): Pet[] {
  return [new Cat("tom"), new Kitten("kit"), new Lion("leo")];
}

export function greet(p: Pet): string {
  p.name = p.name.toUpperCase();
  return p.speak();
}
