import type { Block } from "../../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Plain data is [copied](/docs/boundary/conversions/) at the boundary. Instances of exported classes are not: JavaScript gets a handle to the native object, and every call through it reaches the same instance.",
    },
    {
      kind: "code",
      filename: "playlist.lucent.ts",
      code: `export class Track {
  constructor(readonly title: string, public plays: number = 0) {}
}

export class Playlist {
  private tracks: Track[] = [];

  add(title: string): Track {
    const track = new Track(title);
    this.tracks.push(track);
    return track;
  }

  first(): Track | undefined {
    return this.tracks[0];
  }

  play(track: Track): void {
    track.plays++;
  }

  get titles(): string[] {
    return this.tracks.map((t) => t.title);
  }
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { Playlist, Track } from "./playlist.lucent";

const list = new Playlist();
const song = list.add("Intro");
list.first() === song; // true: the same JS object
song instanceof Track; // true

list.play(song);
song.plays; // 1: read from the native instance

song.plays = 10; // public fields are writable accessors
list.titles.push("x"); // changes a copy; list.titles is still ["Intro"]`,
    },
    { kind: "h2", text: "Identity" },
    {
      kind: "list",
      items: [
        "The same native instance always maps to the same JS object while JavaScript references it, so `===`, `Map` keys and `Set` membership work.",
        "`instanceof` works for the exported class and its Lucent base classes. A value typed as a base class arrives as its most derived class.",
        "Public methods, fields and accessors are shared through the prototype. Fields are read and written on the native object each time, so both sides see changes immediately.",
        "A field or getter that returns an array, record or object type returns a copy each time, like any other result. Mutate through methods instead.",
      ],
    },
    { kind: "h2", text: "Lifetime" },
    {
      kind: "p",
      text: "An instance lives as long as either side holds it. The JS object keeps the native instance alive; when JavaScript drops it and garbage collects it, only native references remain. When those are gone too, the instance is freed.",
    },
    {
      kind: "p",
      text: "Inside Lucent, objects are reference counted. A cycle of strong references (a parent and child that point at each other, or a closure stored on the object it captures) is never freed. Break such cycles yourself, for example by clearing a field when you are done.",
    },
    {
      kind: "note",
      tone: "warn",
      text: "Module state and every instance belong to one JavaScript runtime. A JavaScript reload starts over: module-level variables are reset, and objects from the old runtime cannot be used.",
    },
    { kind: "h2", text: "Interfaces" },
    {
      kind: "p",
      text: "An interface-typed value crosses as its concrete class instance. From JavaScript, only instances of Lucent classes that declare `implements` for that interface are accepted; a plain JS object with the right methods is rejected, because its methods could not run natively.",
    },
    {
      kind: "code",
      filename: "shapes.lucent.ts",
      code: `export interface Shape {
  area(): number;
}

export class Circle implements Shape {
  constructor(readonly radius: number) {}
  area(): number {
    return Math.PI * this.radius ** 2;
  }
}

export class Square implements Shape {
  constructor(readonly side: number) {}
  area(): number {
    return this.side ** 2;
  }
}

export function largest(shapes: Shape[]): Shape | undefined {
  let best: Shape | undefined;
  for (const s of shapes) if (!best || s.area() > best.area()) best = s;
  return best;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { Circle, Square, largest } from "./shapes.lucent";

const big = new Circle(2);
largest([new Square(1), big]) === big; // true

largest([{ area: () => 1 }]);
// TypeError: largest: argument 'shapes'[0] must be a Shape (Circle, Square), got an object`,
    },
    {
      kind: "p",
      text: "To let JavaScript provide behavior, take a [callback](/docs/boundary/callbacks/) instead of an interface. Classes and interfaces themselves are covered in [Classes](/docs/language/classes/).",
    },
];
