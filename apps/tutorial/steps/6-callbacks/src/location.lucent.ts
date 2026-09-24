import { PLATFORM } from "lucent:platform";
import {
  CLLocation,
  CLLocationManager,
  type CLLocationManagerDelegate,
} from "lucent:ios/CoreLocation";
import { Location, LocationManager } from "lucent:android/android.location";
import { Looper } from "lucent:android/android.os";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";
import { error } from "lucent:core";
import type { Fix } from "./trip.lucent";

// --- iOS ---------------------------------------------------------------------

function fromCLLocation(location: CLLocation): Fix {
  const c = location.coordinate;
  return { latitude: c.latitude, longitude: c.longitude, time: location.timestamp.getTime() };
}

/** Forwards a manager's updates to a Lucent function. */
class Updates implements CLLocationManagerDelegate {
  constructor(private readonly onFix: (fix: Fix) => void) {}

  locationManager_didUpdateLocations(manager: CLLocationManager, locations: CLLocation[]): void {
    for (const location of locations) this.onFix(fromCLLocation(location));
  }
}

// Managers deliver to the thread that made them: made on the main thread, kept here.
const managers = new Map<number, CLLocationManager>();

// --- Android -----------------------------------------------------------------

function fromLocation(location: Location): Fix {
  return {
    latitude: location.getLatitude(),
    longitude: location.getLongitude(),
    time: location.getTime(),
  };
}

const listeners = new Map<number, (location: Location) => void>();

// --- The module --------------------------------------------------------------

let nextId = 1;

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

/** Calls `onFix` with each new position, until `stop(id)`. */
export async function watch(onFix: (fix: Fix) => void): Promise<number> {
  const id = nextId++;
  if (PLATFORM === "ios") {
    const updates = new Updates(onFix);
    await main(() => {
      const manager = new CLLocationManager();
      manager.delegate = updates;
      managers.set(id, manager);
      manager.startUpdatingLocation();
    });
  } else {
    const manager = appContext().getSystemService(LocationManager);
    const looper = Looper.getMainLooper();
    if (!manager || !looper)
      throw error("E_NO_LOCATION", "Location isn't available on this device");
    const listener = (location: Location) => onFix(fromLocation(location));
    listeners.set(id, listener);
    manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, listener, looper);
  }
  return id;
}

/** Stops the updates `watch` started, and lets go of its callback. */
export async function stop(id: number): Promise<void> {
  if (PLATFORM === "ios") {
    const manager = managers.get(id);
    managers.delete(id);
    if (manager) await main(() => manager.stopUpdatingLocation());
  } else {
    const listener = listeners.get(id);
    listeners.delete(id);
    if (listener) appContext().getSystemService(LocationManager)?.removeUpdates(listener);
  }
}
