// Promises and subscriptions over the orb's pulse listener, written by the
// package: Lucent knows neither the orb nor its listener.

/** The first level the orb reports after `emitted` levels are sent. */
export declare function firstPulse(emitted: number, signal?: AbortSignal): Promise<number>;

/** The levels the orb reports until it breaks, as a line of text. */
export declare function pulsesUntilBroken(emitted: number): Promise<string>;

/** The levels seen before `signal` aborts the subscription. */
export declare function pulsesUntilAborted(stopAt: number): Promise<string>;
