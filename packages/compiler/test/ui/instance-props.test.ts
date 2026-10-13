import { describe, expect, it } from "vite-plus/test";
import { messages, one, views } from "./fixture.ts";

/*
 * Instances of exported classes as view props (decision 0075): a prop may
 * be one, optional or null or in an array, which crosses as its id. A
 * view's code runs on the main thread without its module's lock, so a
 * member it uses that code off the main thread uses too, one of them
 * writing it, is refused where the view uses it, naming both uses.
 */

/** A player whose members each show one rule. */
const PLAYER = `import { Label } from "./native";
import { main } from "lucent:thread";

let made = 0;

export class Player {
  readonly id = made++;
  title: string;
  private shown = 0;
  private rate = 1;
  private readonly queue: string[] = [];

  constructor(title: string) {
    this.title = title;
  }

  /** What a view shows: a field nothing writes once made. */
  show(): string {
    return \`#\${this.id}\`;
  }

  /** Counts on whichever thread runs it: a view and JavaScript both do. */
  count(): number {
    return ++this.shown;
  }

  /** Writes the rate on the main thread, holding the lock. */
  speed(rate: number): void {
    void main(() => {
      this.rate = rate;
    });
  }

  enqueue(item: string): void {
    this.queue.push(item);
  }
}
`;

describe("an instance prop", () => {
  it("is an instance of an exported class, optional, null or in an array", () => {
    const a = one(`${PLAYER}
export function PlayerView(props: {
  player: Player;
  next?: Player | null;
  queue: Player[];
}): Label {
  const label = new Label();
  label.text = props.player.show();
  return label;
}
`);

    expect(a.diagnostics).toEqual([]);

    const instance = { k: "instance", class: "m.Player", name: "Player", module: "m" };
    expect(a.components[0]!.props).toEqual([
      { name: "player", type: instance, optional: false },
      { name: "next", type: { k: "nullable", inner: instance }, optional: true },
      { name: "queue", type: { k: "array", element: instance }, optional: false },
    ]);
  });

  it("is refused for a class its module does not export, one taking type arguments, and outside props", () => {
    const a = one(`import { Label } from "./native";

class Hidden {
  x = 0;
}

export class Box<T> {
  item?: T;
}

export class Thing {
  n = 0;
}

export function Bad(props: {
  hidden: Hidden;
  box: Box<number>;
  onPick: (thing: Thing) => void;
}): Label {
  return new Label();
}
`);

    expect(a.components).toEqual([]);
    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s prop `hidden` is a `Hidden`, which its module does not export: a prop takes instances of an exported class, which JavaScript makes",
      "`Bad`'s prop `box` is a `Box`, an instance of a generic class: a prop's class takes no type arguments",
      "`Bad`'s event `onPick` sends `thing`, which is a `Thing`, an instance: only a prop may be one",
    ]);
  });

  it("may be read where nothing writes what is read, and its main-thread members used", () => {
    const a = one(`${PLAYER}
export function PlayerView(props: { player: Player }): Label {
  const label = new Label();
  label.text = props.player.show() + String(props.player.id);
  props.player.speed(2);
  return label;
}
`);

    expect(a.diagnostics).toEqual([]);
  });

  it("refuses a member a view writes that JavaScript's calls write too, naming both", () => {
    const a = one(`${PLAYER}
export function PlayerView(props: { player: Player }): Label {
  const label = new Label();
  label.text = String(props.player.count());
  return label;
}
`);

    expect(a.components).toEqual([]);
    expect(messages(a, "LUCENT3022")).toEqual([
      "`PlayerView` cannot run on the main thread: it calls `props.player.count` (m.lucent.tsx:41:23), which writes `Player.shown` (m.lucent.tsx:24:14). It is not the main thread's alone: `Player.count` (m.lucent.tsx:24:14) writes it.",
    ]);
  });

  it("refuses a public field JavaScript may write, and data a member holds", () => {
    const a = one(`${PLAYER}
export function PlayerView(props: { player: Player }): Label {
  const label = new Label();
  label.text = props.player.title;
  props.player.enqueue("x");
  return label;
}
`);

    expect(messages(a, "LUCENT3022")).toEqual([
      "`PlayerView` cannot run on the main thread: it reads `Player.title` (m.lucent.tsx:41:16). It is not the main thread's alone: JavaScript may write it, a public field that is not `readonly`.",
      "`PlayerView` cannot run on the main thread: it calls `props.player.enqueue` (m.lucent.tsx:42:3), which writes `Player.queue` (m.lucent.tsx:35:5). It is not the main thread's alone: `Player.enqueue` (m.lucent.tsx:35:5) writes it.",
    ]);
  });

  it("sees a member read by destructuring, and one an interface names", () => {
    const a = one(`${PLAYER}
interface Titled {
  title: string;
}

export class Song implements Titled {
  title = "";
}

function titleOf(t: Titled): string {
  return t.title;
}

export function PlayerView(props: { player: Player; song: Song }): Label {
  const label = new Label();
  const { title } = props.player;
  label.text = title + titleOf(props.song);
  return label;
}
`);

    expect(messages(a, "LUCENT3022").map((m) => m.slice(0, m.indexOf(". It is")))).toEqual([
      "`PlayerView` cannot run on the main thread: it reads `Player.title` (m.lucent.tsx:53:11)",
      "`PlayerView` cannot run on the main thread: it calls `titleOf` (m.lucent.tsx:54:24), which reads `Song.title` (m.lucent.tsx:48:10)",
    ]);
  });

  it("checks the instances an instance's members hold, and the uses in a view's handlers and commands", () => {
    const a = views({
      "ui.lucent.tsx": `import { Label } from "./native";
import { expose } from "./ui";

export class Track {
  plays = 0;
}

export class Album {
  readonly tracks: Track[] = [];

  add(): Track {
    const t = new Track();
    this.tracks.push(t);
    return t;
  }

  play(t: Track): void {
    t.plays++;
  }
}

export function AlbumView(props: { album: Album }): Label {
  const label = new Label();
  label.onTap(() => {
    label.text = String(props.album.tracks.length);
  });
  expose({ replay: () => props.album.play(props.album.add()) });
  return label;
}
`,
    });

    expect(messages(a, "LUCENT3022")).toEqual([
      "`AlbumView` cannot run on the main thread: it makes `replay` (ui.lucent.tsx:27:20), which calls `props.album.add` (ui.lucent.tsx:27:43), which writes `Album.tracks` (ui.lucent.tsx:13:5). It is not the main thread's alone: `Album.add` (ui.lucent.tsx:13:5) writes it.",
      "`AlbumView` cannot run on the main thread: it makes `replay` (ui.lucent.tsx:27:20), which calls `props.album.play` (ui.lucent.tsx:27:26), which writes `Track.plays` (ui.lucent.tsx:18:5). It is not the main thread's alone: `Album.play` (ui.lucent.tsx:18:5) writes it.",
    ]);
  });
});
