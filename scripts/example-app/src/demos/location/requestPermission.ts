import { requestForegroundPermissionAsync } from "./locationPermission.lucent";

/** Asks for location access while the app is in use: the Lucent module asks on both platforms. */
export async function requestPermission(): Promise<string> {
  return requestForegroundPermissionAsync();
}
