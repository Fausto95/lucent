// A Fragment written in Lucent: on Android, one the FragmentManager makes
// by its name when it restores it (panel.android.lucent.ts); iOS has none.

/**
 * Shows the panel over the Activity's content, then has the
 * FragmentManager save it and make it again, as Android does when it
 * recreates the Activity. Says how many panels were made, how many views
 * they made, and the state the new one got back ("none" on iOS).
 */
export declare function showAndRestore(): Promise<string>;
