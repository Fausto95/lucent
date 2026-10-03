/**
 * A component written as JSX of UIKit views (T48): a stack view whose
 * children are a label showing a prop and a switch whose changes are an
 * event. Nothing about these classes is in Lucent: the tags, their
 * attributes, their construction and how the stack takes its children come
 * from UIKit's declarations, by rule.
 */
export const SETTINGS = {
  "settings.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Props = { title: string; enabled: boolean; onToggle?: (on: boolean) => void };

export declare function Settings(props: Props): UIView | View;
`,
  "settings.ios.lucent.tsx": `import { UILabel, UIStackView, UISwitch, type UIView } from "lucent:ios/UIKit";
import type { Props } from "./settings.lucent";

export function Settings(props: Props): UIView {
  return (
    <UIStackView spacing={8}>
      <UILabel text={props.title} numberOfLines={1n} />
      <UISwitch isOn={props.enabled} onValueChanged={(control) => props.onToggle?.(control.isOn)} />
    </UIStackView>
  );
}
`,
  "settings.android.lucent.tsx": `import { CheckBox, LinearLayout, TextView } from "lucent:android/android.widget";
import type { View } from "lucent:android/android.view";
import type { Props } from "./settings.lucent";

export function Settings(props: Props): View {
  return (
    <LinearLayout orientation={1}>
      <TextView text={props.title} />
      <CheckBox checked={props.enabled} onCheckedChange={(_box, on) => props.onToggle?.(on)} />
    </LinearLayout>
  );
}
`,
};
