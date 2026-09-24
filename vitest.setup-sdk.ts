/**
 * Extracts the SDK modules the tests import before any test runs, so a cold
 * cache (a new Xcode, CI) costs one wait here instead of timeouts in
 * whichever test comes first. Extraction happens on demand without it.
 */
import { prefetch, sdkAvailable } from "./packages/bindgen/src/provider.ts";

export default function setup(): void {
  if (sdkAvailable("ios")) prefetch("ios", ["UIKit", "Foundation", "Security"]);
  if (sdkAvailable("android"))
    prefetch("android", ["android.os", "android.content", "android.util"]);
}
