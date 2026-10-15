// What the app's own Swift and Kotlin did with a Lucent module (T114). The
// Expo app's native projects are made at prebuild, so it has no such code;
// the bare app, whose AppDelegate.swift and MainApplication.kt call one,
// replaces this file (scripts/example-app-bare).
import type { SdkCase } from "../sdk/types";

export const nativeCallerCases: SdkCase[] = [];
