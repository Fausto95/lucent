// lucent:ui's ComponentView (T124): a component's ref as a module function
// gets it, kept and compared as the object JavaScript passed. The test
// passes objects with a view's tag on them, as a component's ref has.
import type { ComponentView } from "lucent:ui";

let kept: ComponentView | undefined;

export function keep(view: ComponentView): string {
  const same = kept === view;
  kept = view;
  return `${String(view)} ${same}`;
}

export function isKept(view: ComponentView): boolean {
  return kept === view;
}

export async function later(view: ComponentView): Promise<boolean> {
  await Promise.resolve();
  return kept === view;
}

export function both(views: ComponentView[]): number {
  return views.filter((v) => v === kept).length;
}
