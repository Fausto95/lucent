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
    this.fixes.push(fix);
  }

  get count(): number {
    return this.fixes.length;
  }

  summary(): TripSummary {
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
}
