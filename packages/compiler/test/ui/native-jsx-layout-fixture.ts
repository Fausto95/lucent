/**
 * Native view JSX laid out by Yoga (T50): a row (a Flex) with padding and
 * a gap, holding a label sized by its text, a spacer that grows, a
 * column (a nested Flex) whose labels are a keyed list, its width a
 * reactive `layout`, and a stack view that lays out its own children.
 */
export const CARD = {
  "card.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Tag = { id: string; name: string };

export type Props = { title: string; wide: boolean; tags: Tag[] };

export declare function Card(props: Props): UIView | View;
`,
  "card.ios.lucent.tsx": `import { Flex } from "lucent:ui";
import { UILabel, UIStackView, UIView } from "lucent:ios/UIKit";
import type { Props } from "./card.lucent";

export function Card(props: Props): UIView {
  return (
    <Flex style={{ flexDirection: "row", padding: 10, gap: 8, alignItems: "flex-start" }}>
      <UILabel text={props.title} />
      <UIView layout={{ flexGrow: 1, height: 1 }} />
      <Flex style={{ gap: 4 }} layout={{ width: props.wide ? 120 : 60 }}>
        {props.tags.map((tag) => (
          <UILabel key={tag.id} text={tag.name} />
        ))}
      </Flex>
      <UIStackView axis={1} spacing={2} layout={{ margin: 4 }}>
        <UILabel text="x" />
        <UILabel text="y" />
      </UIStackView>
    </Flex>
  );
}
`,
  "card.android.lucent.tsx": `import { Flex } from "lucent:ui";
import { LinearLayout, TextView } from "lucent:android/android.widget";
import { View } from "lucent:android/android.view";
import type { Props } from "./card.lucent";

export function Card(props: Props): View {
  return (
    <Flex style={{ flexDirection: "row", padding: 10, gap: 8, alignItems: "flex-start" }}>
      <TextView text={props.title} />
      <View layout={{ flexGrow: 1, height: 1 }} />
      <Flex style={{ gap: 4 }} layout={{ width: props.wide ? 120 : 60 }}>
        {props.tags.map((tag) => (
          <TextView key={tag.id} text={tag.name} />
        ))}
      </Flex>
      <LinearLayout orientation={1} layout={{ margin: 4 }}>
        <TextView text="x" />
        <TextView text="y" />
      </LinearLayout>
    </Flex>
  );
}
`,
};
