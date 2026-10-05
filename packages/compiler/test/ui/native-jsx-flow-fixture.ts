/**
 * Native view JSX whose children come and go (T49): a stack view with a
 * label always there, a note shown under a condition, one of two labels
 * by another, and a closing label; and a list of labels by key.
 */
export const ROWS = {
  "rows.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Row = { id: string; title: string };

export type Props = { title: string; showNote: boolean; dark: boolean; rows: Row[] };

export declare function Rows(props: Props): UIView | View;
`,
  "rows.ios.lucent.tsx": `import { UILabel, UIStackView, type UIView } from "lucent:ios/UIKit";
import type { Props } from "./rows.lucent";

export function Rows(props: Props): UIView {
  return (
    <UIStackView spacing={4}>
      <UILabel text={props.title} />
      {props.showNote && <UILabel text="note" />}
      {props.dark ? <UILabel text="dark" /> : <UILabel text="light" />}
      {props.rows.map((row) => (
        <UILabel key={row.id} text={row.title} />
      ))}
      <UILabel text="end" />
    </UIStackView>
  );
}
`,
  "rows.android.lucent.tsx": `import { LinearLayout, TextView } from "lucent:android/android.widget";
import type { View } from "lucent:android/android.view";
import type { Props } from "./rows.lucent";

export function Rows(props: Props): View {
  return (
    <LinearLayout orientation={1}>
      <TextView text={props.title} />
      {props.showNote && <TextView text="note" />}
      {props.dark ? <TextView text="dark" /> : <TextView text="light" />}
      {props.rows.map((row) => (
        <TextView key={row.id} text={row.title} />
      ))}
      <TextView text="end" />
    </LinearLayout>
  );
}
`,
};
