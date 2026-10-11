// The accelerometer and the gyroscope, streamed to JavaScript. iOS reads
// CoreMotion's CMMotionManager, whose handler runs on an OperationQueue it
// is given; Android registers a SensorEventListener with the
// SensorManager. Both report in the same units: g for acceleration (iOS's
// unit; Android's m/s² divided by standard gravity) and rad/s for
// rotation. Samples are throttled to the interval JavaScript asks for.
import { error, EventEmitter, subscribe } from "lucent:core";
import { PLATFORM } from "lucent:platform";
import { CMMotionManager } from "lucent:ios/CoreMotion";
import { OperationQueue } from "lucent:ios/Foundation";
import { appContext } from "lucent:android";
import {
  Sensor,
  SensorEvent,
  type SensorEventListener,
  SensorManager,
} from "lucent:android/android.hardware";

export type SensorKind = "accelerometer" | "gyroscope";

/** One reading: x, y and z, and when it was taken (ms since boot, the sensor's clock). */
export type Sample = { x: number; y: number; z: number; timestamp: number };

export type Availability = { accelerometer: boolean; gyroscope: boolean };

const STANDARD_GRAVITY = 9.80665;

function checkInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms < 5 || ms > 10_000)
    throw error("E_SENSOR_INTERVAL", `interval ${ms} ms is outside 5 to 10000`);
  return ms;
}

// --- iOS: CoreMotion ---------------------------------------------------------

// One manager for the app, as Apple asks: several degrade the update rate.
// Made on first use, so Android never makes it.
let manager: CMMotionManager | null = null;
let queue: OperationQueue | null = null;

function motion(): CMMotionManager {
  manager ??= new CMMotionManager();
  return manager;
}

function updates(): OperationQueue {
  queue ??= new OperationQueue();
  return queue;
}

function iosWatch(
  kind: SensorKind,
  intervalMs: number,
  onSample: (sample: Sample) => void,
  signal: AbortSignal,
): Promise<void> {
  const seconds = intervalMs / 1000;
  const m = motion();
  return subscribe<Sample>(
    (next, _end, fail) => {
      if (kind === "accelerometer") {
        if (!m.isAccelerometerAvailable)
          throw error("E_SENSOR_UNAVAILABLE", "this device has no accelerometer");
        m.accelerometerUpdateInterval = seconds;
        m.startAccelerometerUpdates(updates(), (data, failure) => {
          if (failure) return fail(failure);
          if (!data) return;
          const a = data.acceleration;
          next({ x: a.x, y: a.y, z: a.z, timestamp: data.timestamp * 1000 });
        });
        return () => m.stopAccelerometerUpdates();
      }
      if (!m.isGyroAvailable) throw error("E_SENSOR_UNAVAILABLE", "this device has no gyroscope");
      m.gyroUpdateInterval = seconds;
      m.startGyroUpdates(updates(), (data, failure) => {
        if (failure) return fail(failure);
        if (!data) return;
        const r = data.rotationRate;
        next({ x: r.x, y: r.y, z: r.z, timestamp: data.timestamp * 1000 });
      });
      return () => m.stopGyroUpdates();
    },
    onSample,
    signal,
  );
}

// --- Android: SensorManager --------------------------------------------------

function sensorManager(): SensorManager {
  const manager = appContext().getSystemService(SensorManager);
  if (!manager) throw error("E_SENSOR_UNAVAILABLE", "SensorManager is not available");
  return manager;
}

function androidType(kind: SensorKind): number {
  return kind === "accelerometer" ? Sensor.TYPE_ACCELEROMETER : Sensor.TYPE_GYROSCOPE;
}

/** Forwards a sensor's events, at most one per interval. */
class Readings implements SensorEventListener {
  private last = -Infinity;

  constructor(
    private readonly kind: SensorKind,
    private readonly intervalMs: number,
    private readonly next: (sample: Sample) => void,
  ) {}

  onSensorChanged(event: SensorEvent): void {
    // A Java array field, so nullable; Android always fills it.
    const v = event.values;
    if (v === null) return;
    // event.timestamp is in nanoseconds since boot: a Java long, so a bigint.
    const timestamp = Number(event.timestamp / 1000n) / 1000;
    if (timestamp - this.last < this.intervalMs) return;
    this.last = timestamp;
    const scale = this.kind === "accelerometer" ? 1 / STANDARD_GRAVITY : 1;
    this.next({
      x: (v[0] ?? 0) * scale,
      y: (v[1] ?? 0) * scale,
      z: (v[2] ?? 0) * scale,
      timestamp,
    });
  }

  onAccuracyChanged(_sensor: Sensor | null, _accuracy: number): void {}
}

function androidWatch(
  kind: SensorKind,
  intervalMs: number,
  onSample: (sample: Sample) => void,
  signal: AbortSignal,
): Promise<void> {
  const sensors = sensorManager();
  const sensor = sensors.getDefaultSensor(androidType(kind));
  if (!sensor) throw error("E_SENSOR_UNAVAILABLE", `this device has no ${kind}`);
  return subscribe<Sample>(
    (next) => {
      const listener = new Readings(kind, intervalMs, next);
      // The rate is a hint in microseconds; Readings throttles to the interval itself.
      sensors.registerListener(listener, sensor, Math.round(intervalMs * 1000));
      return () => sensors.unregisterListener(listener);
    },
    onSample,
    signal,
  );
}

// --- The module --------------------------------------------------------------

/** Which sensors this device has. */
export async function availability(): Promise<Availability> {
  if (PLATFORM === "ios") {
    const m = motion();
    return { accelerometer: m.isAccelerometerAvailable, gyroscope: m.isGyroAvailable };
  }
  const sensors = sensorManager();
  return {
    accelerometer: sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) !== null,
    gyroscope: sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE) !== null,
  };
}

/**
 * Calls `onSample` with each reading of `kind`, at most one every
 * `intervalMs`, until `signal` aborts. Rejects with E_SENSOR_UNAVAILABLE
 * on a device without that sensor.
 */
export async function watch(
  kind: SensorKind,
  intervalMs: number,
  onSample: (sample: Sample) => void,
  signal: AbortSignal,
): Promise<void> {
  const ms = checkInterval(intervalMs);
  if (PLATFORM === "ios") return iosWatch(kind, ms, onSample, signal);
  return androidWatch(kind, ms, onSample, signal);
}

// --- Events: the sensors run while JavaScript listens ---------------------------

/** How often the events' readings come. */
const EVENT_INTERVAL_MS = 50;

/**
 * Each sensor's readings as events, every 50 ms. The first listener
 * starts the sensor and the last one stops it (onObserved), so nothing
 * runs while nobody listens; a reload stops it too.
 */
export const sensorEvents = new EventEmitter<{
  accelerometer: (sample: Sample) => void;
  gyroscope: (sample: Sample) => void;
}>();

/** What stops each sensor the events are running. */
const running = new Map<SensorKind, AbortController>();

/** Sends `sample` as `kind`'s event: code names an event by a literal. */
function send(kind: SensorKind, sample: Sample): void {
  if (kind === "accelerometer") sensorEvents.emit("accelerometer", sample);
  else sensorEvents.emit("gyroscope", sample);
}

/** Streams `kind` into its event until `signal` aborts; a device without it sends nothing. */
async function stream(kind: SensorKind, signal: AbortSignal): Promise<void> {
  try {
    await watch(kind, EVENT_INTERVAL_MS, (sample) => send(kind, sample), signal);
  } catch {
    // Stopped (an AbortError), or the device has no such sensor: availability() says which.
  }
}

/** Starts `kind` when its event is observed, and stops it when it no longer is. */
function run(kind: SensorKind, observed: boolean): void {
  running.get(kind)?.abort();
  running.delete(kind);
  if (!observed) return;
  const controller = new AbortController();
  running.set(kind, controller);
  void stream(kind, controller.signal);
}

// For the module's life: the observers are never removed. A declaration,
// as the top level of a Lucent module holds only declarations.
const _following = [
  sensorEvents.onObserved("accelerometer", (observed) => run("accelerometer", observed)),
  sensorEvents.onObserved("gyroscope", (observed) => run("gyroscope", observed)),
];

/** The magnitude of a sample: about 1 g at rest for the accelerometer. */
export function magnitude(sample: Sample): number {
  return Math.hypot(sample.x, sample.y, sample.z);
}
