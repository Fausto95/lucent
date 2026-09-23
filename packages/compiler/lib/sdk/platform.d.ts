// lucent:platform — which platform the code runs on.

/**
 * The platform: `if (PLATFORM === "ios") { … } else { … }` and
 * `PLATFORM === "ios" ? … : …` compile each platform's branch only, so a
 * shared module can use `lucent:ios/…` and `lucent:android/…` in them.
 */
export declare const PLATFORM: "ios" | "android";
