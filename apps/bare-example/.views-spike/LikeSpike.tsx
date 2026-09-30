// The like spike's screen: three Like buttons, the documentation's
// one-file component (like.lucent.tsx, SwiftUI on iOS and Jetpack Compose
// on Android, as it is published), centered on a plain background for
// screenshots. A tap likes one: its heart fills and pops, and its count
// goes up by one. The screen logs each button's layout (a LUCENT_VIEWS
// line) and nothing else on screen.
import { type LayoutChangeEvent, SafeAreaView, View } from "react-native";
// Components' React exports exist only when views are generated.
import * as like from "./like.lucent";

const { Like } = like as unknown as {
  Like: (props: { count: number; style?: object }) => React.ReactNode;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

const COUNTS = [41, 7, 128];

export function LikeSpike() {
  const layout = (count: number) => (e: LayoutChangeEvent) => {
    const { x, y, width: w, height: h } = e.nativeEvent.layout;

    log(
      `layout like ${count} at ${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)}`,
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 48 }}>
        {COUNTS.map((count) => (
          <View key={count} onLayout={layout(count)}>
            <Like count={count} />
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}
