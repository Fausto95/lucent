// lucent:ios — iOS helpers for platform code.

/** Whether the OS is at least `major.minor` (Swift's `#available`). */
export declare function available(platform: "ios", major: number, minor?: number): boolean;

/** The root of Objective-C objects. Values of type `Any` (`id`) arrive as NSObjects. */
export declare class NSObject {
  private readonly __lucent_NSObject: never;
  private constructor();
}

/** What can go where Objective-C takes `Any` (`id`), CoreFoundation values included. */
export type ObjCValue = string | number | boolean | Uint8Array | Date | NSObject | null;

/** Swift's `as? String`: the string an `Any` holds, or null. */
export declare function asString(value: NSObject | null): string | null;
/** Swift's `as? Double` (an NSNumber). */
export declare function asNumber(value: NSObject | null): number | null;
/** Swift's `as? Bool` (an NSNumber). */
export declare function asBoolean(value: NSObject | null): boolean | null;
/** Swift's `as? Data`. */
export declare function asData(value: NSObject | null): Uint8Array | null;
/** Swift's `as? Date`. */
export declare function asDate(value: NSObject | null): Date | null;

/** An out-parameter of a C function (`CFTypeRef *`): pass it, then read `value`. */
export declare class Out<T> {
  constructor();
  readonly value: T | null;
}
