import { Text } from "react-native";
import { distance, speed } from "./src/trip.lucent";

// The Eiffel Tower, then the Louvre 40 minutes later.
const start = { latitude: 48.8584, longitude: 2.2945, time: 0 };
const end = { latitude: 48.8606, longitude: 2.3376, time: 40 * 60 * 1000 };

export default function App() {
  return (
    <Text>
      {(distance(start, end) / 1000).toFixed(2)} km at {speed(start, end).toFixed(1)} m/s
    </Text>
  );
}
