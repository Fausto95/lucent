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
