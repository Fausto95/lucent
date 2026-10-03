import { appContext } from "lucent:android";
import { View } from "lucent:android/android.view";
import type { Props } from "./dial.lucent";

export function Dial(_props: Props): View {
  return new View(appContext());
}
