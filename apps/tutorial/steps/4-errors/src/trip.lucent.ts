import { error } from "lucent:core";

export type Fix = { latitude: number; longitude: number; time: number };

const EARTH_RADIUS_M = 6371000;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Meters between two fixes, along the Earth's surface. */
export function distance(a: Fix, b: Fix): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Meters from p to the line through a and b, on a flat map around a. */
function offset(p: Fix, a: Fix, b: Fix): number {
  const scale = Math.cos(radians(a.latitude)) * EARTH_RADIUS_M;
  const x = (f: Fix) => radians(f.longitude - a.longitude) * scale;
  const y = (f: Fix) => radians(f.latitude - a.latitude) * EARTH_RADIUS_M;
  const length = Math.hypot(x(b), y(b));
  if (length === 0) return Math.hypot(x(p), y(p));
  return Math.abs(x(b) * y(p) - y(b) * x(p)) / length;
}

/** Meters per second from a to b. */
export function speed(a: Fix, b: Fix): number {
  const seconds = (b.time - a.time) / 1000;
  return seconds > 0 ? distance(a, b) / seconds : 0;
}

export type TripSummary = { fixes: number; meters: number; seconds: number; topSpeed: number };

/** A trip keeps its fixes in native code; JavaScript holds the Trip. */
export class Trip {
  private fixes: Fix[] = [];

  add(fix: Fix): void {
    const last = this.fixes[this.fixes.length - 1];
    if (last && fix.time < last.time) {
      throw error("E_OUT_OF_ORDER", `A fix at ${fix.time} ms comes before the last one, at ${last.time} ms`);
    }
    this.fixes.push(fix);
  }

  get count(): number {
    return this.fixes.length;
  }

  summary(): TripSummary {
    if (this.fixes.length < 2) throw error("E_TOO_SHORT", "A trip needs at least two fixes");
    let meters = 0;
    let topSpeed = 0;
    for (let i = 1; i < this.fixes.length; i++) {
      const a = this.fixes[i - 1]!;
      const b = this.fixes[i]!;
      meters += distance(a, b);
      topSpeed = Math.max(topSpeed, speed(a, b));
    }
    const first = this.fixes[0];
    const last = this.fixes[this.fixes.length - 1];
    const seconds = first && last ? (last.time - first.time) / 1000 : 0;
    return { fixes: this.fixes.length, meters, seconds, topSpeed };
  }

  /** The fixes that shape the route, within `tolerance` meters (Douglas–Peucker). */
  async simplify(tolerance: number, signal: AbortSignal): Promise<Fix[]> {
    const fixes = this.fixes;
    if (fixes.length < 3) return [...fixes];
    const keep = fixes.map((_, i) => i === 0 || i === fixes.length - 1);
    const spans: [number, number][] = [[0, fixes.length - 1]];
    while (spans.length > 0) {
      signal.throwIfAborted();
      const [first, last] = spans.pop()!;
      let farthest = -1;
      let farthestOffset = tolerance;
      for (let i = first + 1; i < last; i++) {
        const d = offset(fixes[i]!, fixes[first]!, fixes[last]!);
        if (d > farthestOffset) {
          farthest = i;
          farthestOffset = d;
        }
      }
      if (farthest >= 0) {
        keep[farthest] = true;
        spans.push([first, farthest], [farthest, last]);
      }
    }
    return fixes.filter((_, i) => keep[i] === true);
  }
}
