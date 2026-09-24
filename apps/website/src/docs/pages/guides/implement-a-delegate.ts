import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "heading.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { CLHeading, CLLocationManager, type CLLocationManagerDelegate } from "lucent:ios/CoreLocation";
import { Location, LocationListener, LocationManager } from "lucent:android/android.location";
import { Looper } from "lucent:android/android.os";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";

// iOS: a class that implements the SDK's protocol.
class Compass implements CLLocationManagerDelegate {
  constructor(private readonly onDegrees: (degrees: number) => void) {}

  locationManager_didUpdateHeading(manager: CLLocationManager, heading: CLHeading): void {
    this.onDegrees(heading.magneticHeading);
  }
}

// Android: a class that implements the SDK's interface.
class Bearing implements LocationListener {
  constructor(private readonly onDegrees: (degrees: number) => void) {}

  onLocationChanged(location: Location): void {
    this.onDegrees(location.getBearing());
  }
}

let manager: CLLocationManager | null = null;
let listener: Bearing | null = null;

export async function follow(onDegrees: (degrees: number) => void): Promise<void> {
  if (PLATFORM === "ios") {
    const compass = new Compass(onDegrees);
    await main(() => {
      manager = new CLLocationManager();
      manager.delegate = compass;
      manager.startUpdatingHeading();
    });
  } else {
    const looper = Looper.getMainLooper();
    listener = new Bearing(onDegrees);
    if (looper) appContext().getSystemService(LocationManager)?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, listener, looper);
  }
}`,
  },
  {
    kind: "list",
    items: [
      "`implements` is required: it's what makes a Lucent class usable as the protocol or interface (`LUCENT2008`).",
      "On iOS, a requirement's name is Swift's base name and labels joined with `_`: `locationManager(_:didUpdateHeading:)` is `locationManager_didUpdateHeading`. Implement only the requirements you need.",
      "On Android, methods you don't define keep their Java default body. An interface with one method to implement also takes a plain function.",
      "The SDK keeps your object while it's the delegate or listener. So does your module: `manager` and `listener` stay set until you stop.",
    ],
  },
  {
    kind: "p",
    text: "Callbacks run on the Lucent thread, queued, one at a time with the rest of your Lucent code. A callback whose result the SDK waits for runs at once, on the SDK's thread. On Android, you can also `extends` an SDK class, calling `super()` with no arguments.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "A delegate or listener lives until it's removed. Give every start a stop, as [Send events to JavaScript](/docs/guides/send-events-to-javascript/) does.",
  },
];
