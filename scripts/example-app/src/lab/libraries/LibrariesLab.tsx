import { Card } from "lucent-fragment";
import { useEffect } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { ScreenStack, ScreenStackItem } from "react-native-screens";
import { Stack } from "../../ui/Stack";
import { RunPanel } from "../RunPanel";
import { ProbeRow } from "../sdk/ProbeRow";
import { runProbe } from "../sdk/runProbe";
import { useChecks } from "../useChecks";
import { ANIMATED_ID, libraryCases, SCREEN_ID, TAPPED_ID } from "./cases";
import { tapHeard } from "./taps";

/** Reanimated updates the card's own props: it finds the card's native view through its ref. */
const AnimatedCard = Animated.createAnimatedComponent(Card);

/** A Lucent component inside Reanimated, Gesture Handler and react-native-screens. */
export function LibrariesLab() {
  const { results, running, summary, run } = useChecks("libraries", libraryCases, runProbe);
  const passed = results.filter((r) => r.pass).length;

  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 300 });
  }, [opacity]);
  const faded = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // The legacy API's detector attaches to its child's native view, which it finds by the ref.
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => tapHeard());

  return (
    <GestureHandlerRootView>
      <Stack>
        <RunPanel
          running={running}
          result={summary}
          progress={`${results.length}/${libraryCases.length} run · ${passed} passed`}
          onRun={run}
        />

        <AnimatedCard text="Animated by Reanimated" testID={ANIMATED_ID} style={faded} />

        <GestureDetector gesture={tap}>
          <Card text="Under a Gesture Handler detector" testID={TAPPED_ID} />
        </GestureDetector>

        <View style={{ height: 60 }}>
          <ScreenStack style={{ flex: 1 }}>
            <ScreenStackItem screenId="lucent" headerConfig={{ hidden: true }} style={{ flex: 1 }}>
              <Card text="In a native stack's screen" testID={SCREEN_ID} />
            </ScreenStackItem>
          </ScreenStack>
        </View>

        {results.map((result) => (
          <ProbeRow key={result.name} result={result} />
        ))}
      </Stack>
    </GestureHandlerRootView>
  );
}
