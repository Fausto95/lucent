import type { ComponentType } from "react";
import { BiometricsDemo } from "./biometrics/BiometricsDemo";
import { ComputeDemo } from "./compute/ComputeDemo";
import { CryptoDemo } from "./crypto/CryptoDemo";
import { DeviceDemo } from "./device/DeviceDemo";
import { FilesDemo } from "./files/FilesDemo";
import { HapticsDemo } from "./haptics/HapticsDemo";
import { LocationDemo } from "./location/LocationDemo";
import { NetworkDemo } from "./network/NetworkDemo";
import { SecureStoreDemo } from "./secureStore/SecureStoreDemo";
import { TasksDemo } from "./tasks/TasksDemo";

export interface Demo {
  /** Its route: examples/<id>. */
  id: string;
  title: string;
  /** What it does, in a sentence. */
  summary: string;
  /** The Lucent capability it shows. */
  capability: string;
  /** Its native code: Lucent modules in the app, or packages. */
  sources: readonly string[];
  Screen: ComponentType;
}

export const demos: readonly Demo[] = [
  {
    id: "haptics",
    title: "Haptics & clipboard",
    summary: "Play the system's feedback patterns, and copy and paste text.",
    capability:
      "A Lucent package installed like any npm package, and a module calling UIKit and Android's system services on the main thread.",
    sources: ["lucent-haptics (examples/lucent-haptics)", "src/sdk/clipboard.lucent.ts"],
    Screen: HapticsDemo,
  },
  {
    id: "secure-store",
    title: "Secure storage",
    summary: "Keep a secret in the Keychain or the Android Keystore.",
    capability:
      "Security framework calls on iOS; an AES-GCM key in the Android Keystore encrypting SharedPreferences.",
    sources: ["lucent-secure-store (examples/lucent-secure-store)"],
    Screen: SecureStoreDemo,
  },
  {
    id: "device",
    title: "Device & battery",
    summary: "The device, this app, and the battery and power state.",
    capability:
      "Reading SDK properties, main-thread-only ones through main(), and API-level checks.",
    sources: [
      "src/demos/device/battery.lucent.ts",
      "src/sdk/device.lucent.ts",
      "src/sdk/application.lucent.ts",
    ],
    Screen: DeviceDemo,
  },
  {
    id: "network",
    title: "Network status",
    summary: "The connection now, and every change as it happens.",
    capability:
      "The platform calling Lucent back: a Network framework block on iOS, a NetworkCallback subclass on Android, forwarded to a JavaScript listener.",
    sources: ["src/sdk/netInfo.lucent.ts"],
    Screen: NetworkDemo,
  },
  {
    id: "files",
    title: "Files",
    summary: "Write, list, read and delete notes in the app's sandbox.",
    capability:
      "FileManager and java.io off the JavaScript thread, with bytes as Uint8Array and UTF-8 from lucent:core.",
    sources: ["src/demos/files/sandbox.lucent.ts"],
    Screen: FilesDemo,
  },
  {
    id: "location",
    title: "Location",
    summary: "Ask for access, then find and follow the device's position.",
    capability:
      "A Lucent class as CLLocationManager's delegate, Play services' Task awaited like a promise, and a listener until stopped.",
    sources: ["src/sdk/location.lucent.ts", "src/demos/location/locationPermission.lucent.ts"],
    Screen: LocationDemo,
  },
  {
    id: "biometrics",
    title: "Biometric sign-in",
    summary: "Check Face ID, Touch ID or fingerprints, then sign in.",
    capability:
      "LocalAuthentication with an AbortSignal that withdraws the prompt; on Android, BiometricManager, and the confirm-credential screen started for a result.",
    sources: ["src/demos/biometrics/biometrics.lucent.ts", "src/sdk/localAuthentication.lucent.ts"],
    Screen: BiometricsDemo,
  },
  {
    id: "crypto",
    title: "Crypto",
    summary: "SHA-256, HMAC and AES-GCM with the platform's own crypto.",
    capability:
      "Swift-only CryptoKit through generated shims on iOS; java.security and javax.crypto on Android.",
    sources: ["src/demos/crypto/crypto.lucent.ts"],
    Screen: CryptoDemo,
  },
  {
    id: "compute",
    title: "Image filter",
    summary: "Draw a picture, blur it and find its edges, natively and in JavaScript.",
    capability:
      "Plain TypeScript compiled to C++: the same file runs as JavaScript, for comparison.",
    sources: ["src/demos/compute/pixels.lucent.ts"],
    Screen: ComputeDemo,
  },
  {
    id: "tasks",
    title: "Background work",
    summary: "Count the primes below a billion, watch the progress, cancel midway.",
    capability:
      "An async function on the Lucent thread, reporting through a JavaScript callback and stopped by an AbortController.",
    sources: ["src/demos/tasks/primes.lucent.ts"],
    Screen: TasksDemo,
  },
];
