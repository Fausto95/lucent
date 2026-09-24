/** Homepage samples. The Lucent source and its C++ live in generated/compiler-demo.ts. */
export const appUsage = `import { squaredDistance } from "./src/geo.lucent";

// A synchronous call into the compiled C++.
squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25`;

export const commands = `npm install -D @lucent-lang/lucent
npx lucent init`;

/** Planned, not implemented: shown as a teaser on the homepage (roadmap M2). */
export const platformTeaser = `import { CLLocationManager } from "lucent:ios/CoreLocation";

export function authorization(): number {
  return new CLLocationManager().authorizationStatus;
}`;
