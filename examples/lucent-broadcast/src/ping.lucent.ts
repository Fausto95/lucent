// A broadcast to a receiver written in Lucent: on Android, a
// BroadcastReceiver the OS makes by its name (ping.android.lucent.ts); iOS
// has none.

/** Sends the receiver a broadcast. */
export declare function send(): void;

/** How many broadcasts the receiver heard, and the last one's action ("none" on iOS). */
export declare function heard(): string;
