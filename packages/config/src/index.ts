export interface NativeCapabilities {
  camera?: { reason: string };
  microphone?: { reason: string };
  photos?: { reason: string };
  location?: { whenInUse: { reason: string } };
  bluetooth?: { reason: string };
  notifications?: { environment: "development" | "production" };
  network?: boolean;
  filesystem?: boolean;
  crypto?: boolean;
  device?: boolean;
  clock?: boolean;
  locale?: boolean;
}
export interface NativeConfig {
  capabilities?: NativeCapabilities;
  /** Paths to generated SDK library.json files, relative to the app root. */
  libraries?: Record<string, string>;
}
/** Build tools parse the literal argument; no application code executes during configuration. */
export function defineNativeConfig(config: NativeConfig): NativeConfig {
  return config;
}
