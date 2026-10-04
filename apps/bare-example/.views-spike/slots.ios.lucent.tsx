import { Timer } from "lucent:ios/Foundation";
import { UIColor, UIView, UIView_AutoresizingMask } from "lucent:ios/UIKit";
import { type Children, effect, expose, slot } from "lucent:ui";

export function Card(props: { title: string; inset: number; children?: Children }): UIView {
  const card = new UIView({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  const inner = new UIView({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  const content = slot<UIView>();

  // A yellow frame, clipping a teal view as large as itself, `inset` in: the slot fills the teal view.
  card.backgroundColor = UIColor.systemYellow;
  card.clipsToBounds = true;
  inner.backgroundColor = UIColor.systemTeal;
  inner.autoresizingMask =
    UIView_AutoresizingMask.flexibleWidth | UIView_AutoresizingMask.flexibleHeight;
  card.addSubview(inner);
  inner.addSubview(content);

  effect(() => {
    inner.frame = { origin: { x: props.inset, y: props.inset }, size: inner.frame.size };
  });

  expose({
    // `host <tag> mark <name> placed <yes|no> children <tag>@<x>,<y> …`: each child
    // in the slot, where it shows in the host (points). The host is named the first
    // time it is asked: a recycled host keeps its name and gets a new tag.
    inspect: (): string => {
      const host = card.superview;

      if (host === null) return "unmounted";

      if (host.restorationIdentifier === null) host.restorationIdentifier = `host-${Date.now()}`;

      const at = card.frame.origin;
      const children = content.subviews.map((child) => {
        const p = child.convert({ x: 0, y: 0 }, card);

        return `${child.tag}@${Math.round(p.x + at.x)},${Math.round(p.y + at.y)}`;
      });

      return `host ${host.tag} mark ${host.restorationIdentifier ?? "?"} placed ${content.isDescendant(card) ? "yes" : "no"} children ${children.join(" ")}`;
    },
    // A move no commit or command announces (TA26): a native timer's, 200 ms
    // later, `dx` points right; the children must follow the slot.
    driftLater: (dx: number): void => {
      Timer.scheduledTimer(0.2, false, () => {
        const at = inner.frame.origin;

        inner.frame = { origin: { x: at.x + dx, y: at.y }, size: inner.frame.size };
      });
    },
    // The view a touch at (x, y) of the host reaches, as UIKit hit-tests it:
    // its tag, or which of the card's own views it is.
    probe: (x: number, y: number): string => {
      const host = card.superview;
      const hit = host === null ? null : host.hitTest({ x, y }, null);

      if (hit === null) return "nothing";

      const own = hit === content ? "slot" : hit === inner ? "inner" : hit === card ? "card" : "";

      return own === "" ? `${hit.tag}` : `${hit.tag} (${own})`;
    },
  });

  return card;
}

export function Panel(props: { header: number; children?: Children }): UIView {
  const panel = new UIView({ origin: { x: 0, y: 0 }, size: { width: 100, height: 100 } });
  const head = new UIView({ origin: { x: 0, y: 0 }, size: { width: 100, height: 0 } });
  const body = new UIView({ origin: { x: 0, y: 0 }, size: { width: 100, height: 100 } });
  const content = slot<UIView>();

  // An orange header across the top, the slot filling the teal body below it.
  panel.backgroundColor = UIColor.systemYellow;
  head.backgroundColor = UIColor.systemOrange;
  body.backgroundColor = UIColor.systemTeal;
  head.autoresizingMask = UIView_AutoresizingMask.flexibleWidth;
  body.autoresizingMask =
    UIView_AutoresizingMask.flexibleWidth | UIView_AutoresizingMask.flexibleHeight;
  panel.addSubview(head);
  panel.addSubview(body);
  body.addSubview(content);

  effect(() => {
    const size = panel.bounds.size;

    head.frame = { origin: { x: 0, y: 0 }, size: { width: size.width, height: props.header } };
    body.frame = {
      origin: { x: 0, y: props.header },
      size: { width: size.width, height: size.height - props.header },
    };
  });

  expose({
    // `slot <x>,<y> <w>x<h> children <tag>@<x>,<y> <w>x<h> …`: the slot and each child
    // in it, where they are in the host (points, to a tenth).
    inspect: (): string => {
      if (panel.superview === null) return "unmounted";

      const tenth = (v: number) => Math.round(v * 10) / 10;
      const at = panel.frame.origin;
      const o = body.convert(content.frame.origin, panel);
      const s = content.frame.size;
      const children = content.subviews.map((child) => {
        const p = child.convert({ x: 0, y: 0 }, panel);
        const c = child.frame.size;

        return `${child.tag}@${tenth(p.x + at.x)},${tenth(p.y + at.y)} ${tenth(c.width)}x${tenth(c.height)}`;
      });

      return `slot ${tenth(o.x + at.x)},${tenth(o.y + at.y)} ${tenth(s.width)}x${tenth(s.height)} children ${children.join(" ")}`;
    },
  });

  return panel;
}
