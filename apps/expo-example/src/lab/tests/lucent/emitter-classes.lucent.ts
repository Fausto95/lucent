// A class that extends EventEmitter: its instances are emitters, in Lucent
// and in JavaScript, with their own fields and methods.
import { EventEmitter } from "lucent:core";

type PlayerEvents = {
  tick: (position: number) => void;
  ended: () => void;
};

export class Player extends EventEmitter<PlayerEvents> {
  position = 0;

  constructor(readonly length: number) {
    super();
  }

  play(): void {
    while (this.position < this.length) {
      this.position++;
      this.emit("tick", this.position);
    }
    this.emit("ended");
  }

  ticking(): number {
    return this.listenerCount("tick");
  }
}

/** A subclass: still an emitter of its base's events. */
export class LoudPlayer extends Player {
  shout(): void {
    this.emit("tick", -1);
  }
}

const held = new Player(1);

export function heldPlayer(): Player {
  return held;
}

export function makePlayer(length: number): Player {
  return new Player(length);
}

export function makeLoud(): LoudPlayer {
  return new LoudPlayer(1);
}

export function same(a: Player, b: Player): boolean {
  return a === b;
}

export function playFor(p: Player): void {
  p.play();
}

export function inLucent(): string {
  const p = new Player(3);
  const seen: number[] = [];
  const sub = p.addListener("tick", (n) => seen.push(n));
  let ended = 0;
  p.addListener("ended", () => ended++);
  const observed: boolean[] = [];
  const watch = p.onObserved("ended", (on) => observed.push(on));
  p.play();
  sub.remove();
  const after = p.ticking();
  p.removeAllListeners("ended");
  watch.remove();
  const loud = new LoudPlayer(0);
  let shouted = 0;
  loud.addListener("tick", (n) => (shouted = n));
  loud.shout();
  return `${seen.join()} ${ended} ${after} ${observed.join()} ${shouted} ${loud instanceof Player}`;
}
