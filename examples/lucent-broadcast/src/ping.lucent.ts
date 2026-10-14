// A broadcast to a receiver written in Lucent: on Android, a
// BroadcastReceiver the OS makes by its name (ping.android.lucent.ts); iOS
// has none.

/** Sends the receiver a broadcast. */
export declare function send(): void;

/** How many broadcasts the receiver heard, and the last one's action ("none" on iOS). */
export declare function heard(): string;

/**
 * A sender of the module's broadcasts: a class each platform file writes,
 * which JavaScript and shared code see as this declaration says.
 */
export declare class Pinger {
  constructor(label: string);
  readonly label: string;
  /** Sends a broadcast: whether the platform has receivers to send it to. */
  ping(): boolean;
  /** How many broadcasts this one sent. */
  get sent(): number;
}
