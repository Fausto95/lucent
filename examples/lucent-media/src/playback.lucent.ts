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
 * service goes, and the service plays on. Waits for the new Activity, and
 * says whether there is one, with the service's status ("none" on iOS).
 * The new Activity starts from the intent that launched the old one:
 * `reopen`, a URL to the app, has it open the screen the caller is on.
 */
export declare function outliveActivity(reopen?: string): Promise<string>;
