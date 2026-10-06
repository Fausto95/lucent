class Shown<T> {
  constructor(public v: T) {}

  show(): string {
    return String(this.v);
  }
}

class Sub<T> extends Shown<T> {
  override show(): string {
    return `sub ${super.show()}`;
  }
}

type Maybe = Shown<number | undefined>;

function shows(xs: Maybe[]): string {
  return xs.map((x) => x.show()).join(",");
}

function take(x: Maybe): string {
  return x.show();
}

function give(): Maybe {
  return new Shown(4);
}

export function arrays(): string {
  const mixed = [new Shown(1), new Shown<number | undefined>(undefined)];
  const reversed = [new Shown<number | undefined>(undefined), new Shown(2)];
  const sub = [new Sub(3), new Shown<number | undefined>(undefined)];
  const typed: Maybe[] = [new Shown(5), new Shown<number>(6)];
  const picked = (flag: boolean) => [flag ? new Shown(7) : new Shown<number | undefined>(undefined)];

  return [
    shows(mixed),
    shows(reversed),
    shows(sub),
    shows(typed),
    shows(picked(true)),
    shows(picked(false)),
  ].join(" ");
}

export function positions(): string {
  const declared: Maybe = new Shown(1);
  let assigned: Maybe = new Shown<number | undefined>(undefined);
  assigned = new Shown(2);
  const tuple: [Maybe, number] = [new Shown(3), 0];
  const record: Record<string, Maybe> = { a: new Shown(4) };
  const object: { m: Maybe } = { m: new Shown(5) };
  const union: Maybe | string = new Shown(6);
  const map = new Map<string, Maybe>([["a", new Shown(7)]]);
  map.set("b", new Shown(8));
  const set = new Set<Maybe>();
  set.add(new Shown(9));
  set.add(new Shown(10));

  return [
    declared.show(),
    assigned.show(),
    tuple[0].show(),
    record.a!.show(),
    object.m.show(),
    typeof union === "string" ? union : union.show(),
    [...map.values()].map((x) => x.show()).join(","),
    [...set].map((x) => x.show()).join(","),
    take(new Shown(11)),
    give().show(),
  ].join(" ");
}

export function identity(): string {
  const one = new Shown<number | undefined>(1);
  const xs = [one, new Shown(2)];
  one.v = undefined;

  return `${xs[0] === one} ${xs[0]!.show()} ${JSON.stringify(xs)}`;
}
