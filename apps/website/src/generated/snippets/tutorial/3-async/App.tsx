import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Trip } from "./src/trip.lucent";

// A walk along the Seine, one fix every ten minutes.
const walk = [
  { latitude: 48.8584, longitude: 2.2945, time: 0 },
  { latitude: 48.8637, longitude: 2.3023, time: 10 * 60 * 1000 },
  { latitude: 48.8661, longitude: 2.3125, time: 20 * 60 * 1000 },
  { latitude: 48.8638, longitude: 2.3252, time: 30 * 60 * 1000 },
  { latitude: 48.8606, longitude: 2.3376, time: 40 * 60 * 1000 },
];

const trip = new Trip();
for (const fix of walk) trip.add(fix);

export default function App() {
  const [shape, setShape] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    trip.simplify(100, controller.signal).then(
      (fixes) => setShape(fixes.length),
      () => {}, // aborted: the screen is gone
    );
    return () => controller.abort();
  }, []);

  const summary = trip.summary();
  return (
    <Text>
      {summary.fixes} fixes, {(summary.meters / 1000).toFixed(2)} km, top speed{" "}
      {summary.topSpeed.toFixed(1)} m/s.
      {shape === null ? " Simplifying…" : ` ${shape} fixes shape the route.`}
    </Text>
  );
}
