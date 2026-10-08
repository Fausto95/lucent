import { error, fromCallback } from "lucent:core";
import { PLATFORM } from "lucent:platform";
import {
  CLAuthorizationStatus,
  CLLocation,
  CLLocationManager,
  type CLLocationManagerDelegate,
} from "lucent:ios/CoreLocation";
import { Location, LocationManager } from "lucent:android/android.location";
import { LocationServices, Priority } from "lucent:android/com.google.android.gms.location";
import type { Task } from "lucent:android/com.google.android.gms.tasks";
import { PackageManager } from "lucent:android/android.content.pm";
import { Looper } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
import { main } from "lucent:thread";

export interface LocationObjectCoords {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export interface LocationObject {
  coords: LocationObjectCoords;
  timestamp: number;
}

export interface LocationPermissionResponse {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  expires: string;
}

export interface LocationProviderStatus {
  locationServicesEnabled: boolean;
  backgroundModeEnabled: boolean;
}

let nextId = 1;

// --- iOS ---------------------------------------------------------------------

function fromCLLocation(l: CLLocation): LocationObject {
  const c = l.coordinate;
  return {
    coords: {
      latitude: c.latitude,
      longitude: c.longitude,
      altitude: l.altitude,
      accuracy: l.horizontalAccuracy,
      altitudeAccuracy: l.verticalAccuracy,
      heading: l.course,
      speed: l.speed,
    },
    timestamp: l.timestamp.getTime(),
  };
}

/** Forwards a manager's updates to Lucent functions. */
class Updates implements CLLocationManagerDelegate {
  constructor(
    private readonly onLocation: (location: LocationObject) => void,
    private readonly onError: (error: Error) => void,
  ) {}
  locationManager_didUpdateLocations(manager: CLLocationManager, locations: CLLocation[]): void {
    const last = locations[locations.length - 1];
    if (last) this.onLocation(fromCLLocation(last));
  }
  locationManager_didFailWithError(manager: CLLocationManager, error: Error): void {
    this.onError(error);
  }
}

// Managers deliver to the thread that made them: they are made on the main
// thread, and a request's is kept here until its position or error comes.
const managers = new Map<number, CLLocationManager>();

function iosCurrentPosition(): Promise<LocationObject> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const done = () => {
      managers.get(id)?.stopUpdatingLocation();
      managers.delete(id);
    };
    const updates = new Updates(
      (location) => {
        done();
        resolve(location);
      },
      (error) => {
        done();
        reject(error);
      },
    );
    void main(() => {
      const manager = new CLLocationManager();
      manager.delegate = updates;
      managers.set(id, manager);
      manager.requestLocation();
    });
  });
}

// --- Android -----------------------------------------------------------------

function locationManager(): LocationManager {
  const m = appContext().getSystemService(LocationManager);
  if (!m) throw new Error("LocationManager is not available");
  return m;
}

function granted(permission: string): boolean {
  return appContext().checkSelfPermission(permission) === PackageManager.PERMISSION_GRANTED;
}

function fromLocation(l: Location): LocationObject {
  return {
    coords: {
      latitude: l.getLatitude(),
      longitude: l.getLongitude(),
      altitude: l.getAltitude(),
      accuracy: l.getAccuracy(),
      altitudeAccuracy: available("android", 26) ? l.getVerticalAccuracyMeters() : null,
      heading: l.getBearing(),
      speed: l.getSpeed(),
    },
    timestamp: Number(l.getTime()),
  };
}

function locationEnabled(): boolean {
  const m = locationManager();
  if (available("android", 28)) return m.isLocationEnabled();
  return (
    m.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
    m.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
  );
}

/** GPS where it is on: a fused request at balanced accuracy uses network location, which emulators lack. */
function provider(): string {
  return locationManager().isProviderEnabled(LocationManager.GPS_PROVIDER)
    ? LocationManager.GPS_PROVIDER
    : LocationManager.FUSED_PROVIDER;
}

function lastKnownLocation(): LocationObject | null {
  const m = locationManager();
  let best: Location | null = null;
  const providers = m.getProviders(true);
  for (let i = 0; i < (providers?.size() ?? 0); i++) {
    const l = m.getLastKnownLocation(providers?.get(i) ?? "");
    if (l && (!best || l.getTime() > best.getTime())) best = l;
  }
  return best ? fromLocation(best) : null;
}

/**
 * A Task's result, once its completion listener runs: null when it gives
 * none; rejected with its exception's message, or as cancelled when it has
 * no exception.
 */
function completed(task: Task<Location>): Promise<Location | null> {
  return fromCallback<Location | null>((resolve, reject) => {
    task.addOnCompleteListener((done) => {
      if (done.isSuccessful()) {
        resolve(done.getResult());
        return;
      }

      const failure = done.getException();
      reject(
        failure
          ? new Error(failure.getMessage() ?? failure.toString())
          : error("java.util.concurrent.CancellationException", "cancelled"),
      );
    });
  });
}

/** Play services' fused location, as expo-location reads it: a Task, adapted. */
async function androidCurrentPosition(): Promise<LocationObject> {
  const client = LocationServices.getFusedLocationProviderClient(appContext());
  const location = await completed(
    client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null),
  );
  if (!location) throw new Error("No location available");
  return fromLocation(location);
}

// --- The module --------------------------------------------------------------

export async function getForegroundPermissionsAsync(): Promise<LocationPermissionResponse> {
  if (PLATFORM === "ios") {
    const status = await main(() => new CLLocationManager().authorizationStatus);
    const allowed =
      status === CLAuthorizationStatus.authorizedWhenInUse ||
      status === CLAuthorizationStatus.authorizedAlways;
    const denied =
      status === CLAuthorizationStatus.denied || status === CLAuthorizationStatus.restricted;
    return {
      status: allowed ? "granted" : denied ? "denied" : "undetermined",
      granted: allowed,
      canAskAgain: !denied,
      expires: "never",
    };
  } else {
    const coarse = granted("android.permission.ACCESS_COARSE_LOCATION");
    return {
      status: coarse ? "granted" : "undetermined",
      granted: coarse,
      canAskAgain: true,
      expires: "never",
    };
  }
}

export async function hasServicesEnabledAsync(): Promise<boolean> {
  return PLATFORM === "ios" ? CLLocationManager.locationServicesEnabled() : locationEnabled();
}

export async function getProviderStatusAsync(): Promise<LocationProviderStatus> {
  if (PLATFORM === "ios") {
    return {
      locationServicesEnabled: CLLocationManager.locationServicesEnabled(),
      backgroundModeEnabled: true,
    };
  } else {
    const enabled = locationEnabled();
    return { locationServicesEnabled: enabled, backgroundModeEnabled: enabled };
  }
}

export async function getLastKnownPositionAsync(): Promise<LocationObject | null> {
  if (PLATFORM === "ios") {
    const location = await main(() => new CLLocationManager().location);
    return location ? fromCLLocation(location) : null;
  } else {
    return lastKnownLocation();
  }
}

export function getCurrentPositionAsync(): Promise<LocationObject> {
  return PLATFORM === "ios" ? iosCurrentPosition() : androidCurrentPosition();
}

/**
 * A watch, as expo-location's subscription: it holds the platform's
 * object that delivers the positions, and remove() stops it.
 */
export class LocationSubscription {
  // iOS: the manager, made on the main thread, which calls its delegate there.
  private manager: CLLocationManager | null = null;
  // Android: the listener LocationManager calls, the same Java object each time.
  private listener: ((location: Location) => void) | null = null;

  /** Starts a watch: calls `callback` with each position until remove(). */
  static async start(callback: (location: LocationObject) => void): Promise<LocationSubscription> {
    const subscription = new LocationSubscription();
    if (PLATFORM === "ios") {
      const updates = new Updates(callback, () => {});
      await main(() => {
        const manager = new CLLocationManager();
        manager.delegate = updates;
        subscription.manager = manager;
        manager.startUpdatingLocation();
      });
    } else {
      const listener = (location: Location) => callback(fromLocation(location));
      subscription.listener = listener;
      const looper = Looper.getMainLooper();
      if (looper) locationManager().requestLocationUpdates(provider(), 1000n, 0, listener, looper);
    }
    return subscription;
  }

  /** Stops the watch's updates; removing it again does nothing. */
  remove(): void {
    if (PLATFORM === "ios") {
      const manager = this.manager;
      this.manager = null;
      if (manager) void main(() => manager.stopUpdatingLocation());
    } else {
      const listener = this.listener;
      this.listener = null;
      if (listener) locationManager().removeUpdates(listener);
    }
  }
}

/** Calls `callback` with each position until the subscription's remove(). */
export function watchPositionAsync(
  callback: (location: LocationObject) => void,
): Promise<LocationSubscription> {
  return LocationSubscription.start(callback);
}
