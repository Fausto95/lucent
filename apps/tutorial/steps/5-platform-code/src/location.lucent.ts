import { PLATFORM } from "lucent:platform";
import { CLLocation, CLLocationManager } from "lucent:ios/CoreLocation";
import { Location, LocationManager } from "lucent:android/android.location";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";
import type { Fix } from "./trip.lucent";

// --- iOS ---------------------------------------------------------------------

function fromCLLocation(location: CLLocation): Fix {
  const c = location.coordinate;
  return { latitude: c.latitude, longitude: c.longitude, time: location.timestamp.getTime() };
}

// --- Android -----------------------------------------------------------------

function fromLocation(location: Location): Fix {
  return {
    latitude: location.getLatitude(),
    longitude: location.getLongitude(),
    time: location.getTime(),
  };
}

// --- The module --------------------------------------------------------------

/** The last position the device knows, without waiting for a new one. */
export async function lastFix(): Promise<Fix | null> {
  if (PLATFORM === "ios") {
    const location = await main(() => new CLLocationManager().location);
    return location ? fromCLLocation(location) : null;
  } else {
    const manager = appContext().getSystemService(LocationManager);
    const location = manager?.getLastKnownLocation(LocationManager.GPS_PROVIDER) ?? null;
    return location ? fromLocation(location) : null;
  }
}
