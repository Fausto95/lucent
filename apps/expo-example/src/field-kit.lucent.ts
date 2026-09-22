import { encodeUTF8 } from "@lucent-lang/core";
import { sha256 } from "@lucent-lang/crypto";
import { event } from "@lucent-lang/events";
import { SharedObject } from "@lucent-lang/objects";

export const recorded = event<number>();

/** A small native module: mutable fields, a method, an event, and a platform call. */
export class FieldKit extends SharedObject {
  name: string = "Field kit";
  samples: number = 0;
  constructor(name: string) {
    super();
    this.name = name;
  }
  record(): number {
    this.samples += 1;
    recorded.emit(this.samples);
    return this.samples;
  }
  digest(label: string): string {
    return sha256(encodeUTF8(label));
  }
}
