/**
 * Components taking React children, for the children and host tests:
 * `Card` (both platforms) puts its slot in the view it returns; on iOS,
 * `Pocket` makes a slot it never places, and `Label` takes no children.
 */

/** A card: a native view, its React children in a slot inside it. */
export const CARD: Record<string, string> = {
  "card.lucent.ts": `import type { FrameLayout } from "lucent:android/android.widget";
import type { UIView } from "lucent:ios/UIKit";
import type { Children } from "lucent:ui";

export declare function Card(props: { title: string; children?: Children }): UIView | FrameLayout;
`,
  "card.ios.lucent.tsx": `import { UIColor, UIView } from "lucent:ios/UIKit";
import { type Children, effect, native, slot } from "lucent:ui";

export function Card(props: { title: string; children?: Children }): UIView {
  const card = native(() => new UIView({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } }));
  const content = slot<UIView>();

  card.backgroundColor = UIColor.systemYellow;
  card.addSubview(content);

  effect(() => {
    card.alpha = props.title === "" ? 0.5 : 1;
  });

  return card;
}
`,
  "card.android.lucent.tsx": `import { appContext } from "lucent:android";
import type { ViewGroup } from "lucent:android/android.view";
import { FrameLayout } from "lucent:android/android.widget";
import { type Children, effect, native, slot } from "lucent:ui";

export function Card(props: { title: string; children?: Children }): FrameLayout {
  const card = native(() => new FrameLayout(appContext()));
  const content = slot<ViewGroup>();

  card.addView(content);

  effect(() => {
    card.setContentDescription(props.title);
  });

  return card;
}
`,
};

/** iOS only: a slot left out of the view, and a component taking no children. */
export const IOS_HOSTED: Record<string, string> = {
  "hosted.lucent.ts": `import type { UILabel, UIView } from "lucent:ios/UIKit";
import type { Children } from "lucent:ui";

export declare function Pocket(props: { children?: Children }): UIView;

export declare function Label(props: { text: string }): UILabel;
`,
  "hosted.ios.lucent.tsx": `import { UILabel, UIView } from "lucent:ios/UIKit";
import { type Children, effect, native, slot } from "lucent:ui";

export function Pocket(props: { children?: Children }): UIView {
  const content = slot<UIView>();

  content.alpha = 1;

  return native(() => new UIView({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } }));
}

export function Label(props: { text: string }): UILabel {
  const label = native(() => new UILabel());

  effect(() => {
    label.text = props.text;
  });

  return label;
}
`,
};
