// oxlint-disable no-extraneous-class -- classes holding only static fields are the case
// A module's top-level statements run in source order: a class's static
// fields initialize where the class is declared, between the variables.
let base = 1;
const log: string[] = [];

function record(s: string): number {
  log.push(s);
  return log.length;
}

class C {
  static b = base + 1;
  static note = record("C");
}

const after = record("after");

class B {
  static x = record("B");
}

class D extends B {
  static y = record("D");
}

class A {
  static z = record("A");
}

class Cache {
  static cached?: number;
}

export function staticReadsVariable(): number {
  return C.b;
}

export function order(): string {
  return log.join(",");
}

export function afterValue(): number {
  return after;
}

export function setCached(n: number): void {
  Cache.cached = n;
}

export function cached(): number | undefined {
  return Cache.cached;
}

export function touch(): number {
  return B.x + D.y + A.z;
}
