// Playback in the foreground, from a media3 MediaSessionService written in
// Lucent (playback.android.lucent.ts). iOS has no such service: its media
// sessions belong to the app.

/**
 * Starts the service, which plays a silent clip in a loop, and waits for
 * it to play in the foreground: how many services Android made and ended,
 * and whether one plays ("none" on iOS).
 */
export declare function start(): Promise<string>;

/** How many services Android made and ended, and whether one plays in the foreground ("none" on iOS). */
export declare function status(): Promise<string>;

/**
 * Has Android make the current Activity again, once: what started the
 * service goes, and the service plays on. The first call recreates the
 * Activity and never settles, since its screen goes with it. A later one
 * says whether the Activity is a new one, with the service's status
 * ("none" on iOS).
 */
export declare function outliveActivity(): Promise<string>;
