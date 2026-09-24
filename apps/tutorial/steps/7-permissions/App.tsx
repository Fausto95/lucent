import { useEffect, useState } from "react";
import { PermissionsAndroid, Platform, Text } from "react-native";
import { requestPermission, stop, watch } from "./src/location.lucent";
import { Trip, type TripSummary } from "./src/trip.lucent";

const trip = new Trip();

async function askForLocation(): Promise<void> {
  if (Platform.OS === "android") {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  } else {
    await requestPermission();
  }
}

export default function App() {
  const [summary, setSummary] = useState<TripSummary | null>(null);

  useEffect(() => {
    const started = askForLocation().then(() =>
      watch((fix) => {
        try {
          trip.add(fix);
          if (trip.count >= 2) setSummary(trip.summary());
        } catch (e) {
          if ((e as { code?: string }).code !== "E_OUT_OF_ORDER") throw e;
        }
      }),
    );
    return () => void started.then(stop);
  }, []);

  if (!summary) return <Text>Waiting for two positions…</Text>;
  return (
    <Text>
      {summary.fixes} fixes, {(summary.meters / 1000).toFixed(2)} km, top speed {summary.topSpeed.toFixed(1)} m/s
    </Text>
  );
}
