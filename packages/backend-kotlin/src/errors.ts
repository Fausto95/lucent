import { nativeKotlin } from "./native.ts";

/** Uses only JVM APIs, including for standalone native verification. */
export const kotlinErrorWire = nativeKotlin("LucentErrorWire.kt");
