import { appContext } from "lucent:android";
import type { ViewGroup } from "lucent:android/android.view";
import { FrameLayout, FrameLayout_LayoutParams } from "lucent:android/android.widget";
import { type Children, effect, expose, native, slot } from "lucent:ui";

export function Card(props: { title: string; inset: number; children?: Children }): FrameLayout {
  const card = native(() => new FrameLayout(appContext()));
  const inner = native(() => new FrameLayout(appContext()));
  const content = slot<ViewGroup>();
  const density = appContext().getResources()?.getDisplayMetrics()?.density ?? 1;

  // A yellow frame holding a teal view `inset` in: the slot fills the teal view.
  card.setBackgroundColor(0xffffeb3b | 0);
  inner.setBackgroundColor(0xff26a69a | 0);
  card.addView(inner);
  inner.addView(content);

  effect(() => {
    const px = Math.round(props.inset * density);
    const params = new FrameLayout_LayoutParams(-1, -1);

    params.setMargins(px, px, px, px);
    inner.setLayoutParams(params);
  });

  expose({
    // As on iOS, in density-independent pixels: each child in the slot, where it
    // shows in the host (its frame, less the slot's scroll, plus where the slot is).
    inspect: (): string => {
      const parent = card.getParent();

      if (parent === null) return "unmounted";

      const host = parent as ViewGroup;

      if (host.getContentDescription() === null) host.setContentDescription(`host-${Date.now()}`);

      const x = card.getLeft() + inner.getLeft() + content.getLeft() - content.getScrollX();
      const y = card.getTop() + inner.getTop() + content.getTop() - content.getScrollY();
      const children: string[] = [];

      for (let i = 0; i < content.getChildCount(); i++) {
        const child = content.getChildAt(i);

        if (child !== null)
          children.push(
            `${child.getId()}@${Math.round((x + child.getLeft()) / density)},${Math.round((y + child.getTop()) / density)}`,
          );
      }

      const placed = inner.indexOfChild(content) >= 0 && card.indexOfChild(inner) >= 0;

      return `host ${host.getId()} mark ${host.getContentDescription()?.toString() ?? "?"} placed ${placed ? "yes" : "no"} children ${children.join(" ")}`;
    },
    probe: (x: number, y: number): string => `unsupported ${x},${y}`,
  });

  return card;
}

export function Panel(props: { header: number; children?: Children }): FrameLayout {
  const panel = native(() => new FrameLayout(appContext()));
  const head = native(() => new FrameLayout(appContext()));
  const body = native(() => new FrameLayout(appContext()));
  const content = slot<ViewGroup>();
  const density = appContext().getResources()?.getDisplayMetrics()?.density ?? 1;

  // An orange header across the top, the slot filling the teal body below it.
  panel.setBackgroundColor(0xffffeb3b | 0);
  head.setBackgroundColor(0xffff9800 | 0);
  body.setBackgroundColor(0xff26a69a | 0);
  panel.addView(head);
  panel.addView(body);
  body.addView(content);

  effect(() => {
    const px = Math.round(props.header * density);
    const params = new FrameLayout_LayoutParams(-1, -1);

    head.setLayoutParams(new FrameLayout_LayoutParams(-1, px));
    params.setMargins(0, px, 0, 0);
    body.setLayoutParams(params);
  });

  expose({
    // As on iOS, in density-independent pixels.
    inspect: (): string => {
      if (panel.getParent() === null) return "unmounted";

      const tenth = (px: number) => Math.round((px / density) * 10) / 10;
      const x = panel.getLeft() + body.getLeft() + content.getLeft();
      const y = panel.getTop() + body.getTop() + content.getTop();
      const children: string[] = [];

      for (let i = 0; i < content.getChildCount(); i++) {
        const child = content.getChildAt(i);

        if (child !== null)
          children.push(
            `${child.getId()}@${tenth(x - content.getScrollX() + child.getLeft())},${tenth(y - content.getScrollY() + child.getTop())} ${tenth(child.getWidth())}x${tenth(child.getHeight())}`,
          );
      }

      return `slot ${tenth(x)},${tenth(y)} ${tenth(content.getWidth())}x${tenth(content.getHeight())} children ${children.join(" ")}`;
    },
  });

  return panel;
}
