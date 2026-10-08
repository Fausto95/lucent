/** A delegate that reaches its owner without keeping it alive: no cycle. */
class Updates {
  private readonly owner: WeakRef<Tracker>;

  constructor(owner: Tracker) {
    this.owner = new WeakRef(owner);
  }

  report(n: number): string {
    const owner = this.owner.deref();
    if (!owner) return "owner gone";
    owner.seen.push(n);
    return `${owner.name} saw ${owner.seen.join(",")}`;
  }
}

export class Tracker {
  readonly seen: number[] = [];
  readonly updates: Updates;

  constructor(readonly name: string) {
    this.updates = new Updates(this);
  }
}

export interface Named {
  label(): string;
}

class Tag implements Named {
  constructor(private readonly text: string) {}
  label(): string {
    return this.text;
  }
}

export class TreeNode {
  private parentRef: WeakRef<TreeNode> | undefined;
  readonly children: TreeNode[] = [];

  constructor(readonly name: string) {}

  add(child: TreeNode): TreeNode {
    child.parentRef = new WeakRef(this);
    this.children.push(child);
    return child;
  }

  get parent(): TreeNode | undefined {
    return this.parentRef?.deref();
  }

  path(): string {
    const up = this.parent;
    return up ? `${up.path()}/${this.name}` : this.name;
  }
}

export function delegates(): string {
  const tracker = new Tracker("t");
  tracker.updates.report(1);
  return tracker.updates.report(2);
}

export function trees(): string {
  const root = new TreeNode("root");
  const leaf = root.add(new TreeNode("a")).add(new TreeNode("b"));
  return `${leaf.path()} ${root.parent === undefined} ${leaf.parent?.parent === root}`;
}

export function identities(): string {
  const tag: Named = new Tag("x");
  const a = new WeakRef(tag);
  const b = new WeakRef(tag);
  const sameTarget = a.deref() === b.deref();
  const label = a.deref()?.label() ?? "none";
  return `${a === b} ${a === a} ${sameTarget} ${label}`;
}
