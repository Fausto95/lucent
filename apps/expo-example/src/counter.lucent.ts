import { SharedObject } from "@lucent-lang/core/objects";
export class Counter extends SharedObject {
  value: number = 0;
  constructor(initial: number) {
    super();
    this.value = initial;
  }
  increment(delta: number): number {
    this.value += delta;
    return this.value;
  }
}
