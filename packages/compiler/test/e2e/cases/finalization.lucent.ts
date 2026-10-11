// FinalizationRegistry: a cleanup for what a target held, run once the
// target is gone. Native code runs it as a job soon after the target's
// last reference goes; JavaScript when its collector runs, so this case
// prints only what does not depend on when (docs/semantics.md).

export class Resource {
  constructor(readonly name: string) {}
}

class Token {
  readonly kind = "token";
}

type Handle = { id: number };

const closed: string[] = [];
const registry = new FinalizationRegistry<string>((held) => {
  closed.push(held);
});

export function registers(): string {
  const a = new Resource("a");
  const token = new Token();
  const out: string[] = [];
  out.push(`${registry.register(a, "a", token)}`);
  out.push(`${registry.unregister(token)} ${registry.unregister(token)}`);
  out.push(`${registry.unregister(new Token())}`);
  // Objects and interface values are targets as class instances are.
  const handle: Handle = { id: 1 };
  registry.register(handle, "handle");
  out.push(`${registry.unregister(handle)}`);
  out.push(a.name);
  return out.join(" | ");
}

/** A target that is its own held value is refused, as in JavaScript. */
export function sameTarget(): string {
  const handles = new FinalizationRegistry<Handle>(() => {});
  const h: Handle = { id: 2 };
  try {
    handles.register(h, h);
    return "registered";
  } catch (e) {
    return (e as Error).name;
  }
}

/** One token for several registrations: unregister removes them all. */
export function oneToken(): string {
  const token = new Token();
  const kept = [new Resource("x"), new Resource("y")];
  for (const r of kept) registry.register(r, r.name, token);
  return `${registry.unregister(token)} ${registry.unregister(token)} ${kept.length}`;
}
