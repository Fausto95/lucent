// A media3 MediaSessionService written in Lucent. Exported and extending an
// Android class, it is one the OS makes by its name (decision 0097):
// dev.lucent.app.lucent_media.playback.Playback, which lucent.json declares
// as a mediaPlayback service. Android makes it when start() starts it, and
// its lifecycle methods run while Android waits, calling the base's through
// super (decision 0103). It plays a silent clip in a loop, so media3 keeps
// it in the foreground with its notification, and it holds the module's
// state while it lives: the Activity that started it can go and come back.
import { appContext, currentActivity } from "lucent:android";
import { Intent } from "lucent:android/android.content";
import { MediaItem, Player } from "lucent:android/androidx.media3.common";
import { ExoPlayer_Builder } from "lucent:android/androidx.media3.exoplayer";
import {
  type MediaSession,
  MediaSession_Builder,
  type MediaSession_ControllerInfo,
  MediaSessionService,
} from "lucent:android/androidx.media3.session";
import { delay } from "lucent:core";
import { main } from "lucent:thread";

/** The clip it plays: one second of silence, among the package's Android assets. */
const SILENCE = "asset:///lucent-silence.wav";

let made = 0;
let ended = 0;
let current: Playback | null = null;

export class Playback extends MediaSessionService {
  private session: MediaSession | null = null;

  onCreate(): void {
    super.onCreate();
    // Java's build() says nothing of null: it never gives one.
    const player = new ExoPlayer_Builder(this).build()!;
    player.setMediaItem(MediaItem.fromUri(SILENCE));
    player.setRepeatMode(Player.REPEAT_MODE_ALL);
    player.prepare();
    player.play();
    const session = new MediaSession_Builder(this, player).build();
    this.addSession(session);
    this.session = session;
    made++;
    // oxlint-disable-next-line typescript/no-this-alias -- the module keeps the service it plays in
    current = this;
  }

  onGetSession(_controller: MediaSession_ControllerInfo): MediaSession | null {
    return this.session;
  }

  onDestroy(): void {
    const session = this.session;
    if (session) {
      session.getPlayer()?.release();
      session.release();
    }
    this.session = null;
    ended++;
    current = null;
    super.onDestroy();
  }

  /** Whether media3 runs it in the foreground, playing. */
  playing(): boolean {
    return this.isPlaybackOngoing();
  }
}

export async function status(): Promise<string> {
  const playing = await main(() => current?.playing() ?? false);
  return `${made} made, ${ended} ended, ${playing ? "playing in the foreground" : "not playing"}`;
}

export async function start(): Promise<string> {
  await main(() => {
    const context = appContext();
    const intent = new Intent();
    intent.setClassName(
      context.getPackageName() ?? "",
      "dev.lucent.app.lucent_media.playback.Playback",
    );
    context.startService(intent);
  });

  for (let waited = 0; waited < 10_000; waited += 100) {
    if (await main(() => current?.playing() ?? false)) break;
    await delay(100);
  }
  return status();
}

/** The Activity outliveActivity() recreated, by its identity, or 0 before. */
let recreated = 0;

export async function outliveActivity(): Promise<string> {
  const activity = await main(() => currentActivity()?.hashCode() ?? 0);
  console.log(`[lucent-media] outliveActivity: Activity ${activity}, made again from ${recreated}`);
  if (!recreated) {
    recreated = activity;
    await main(() => currentActivity()?.recreate());
  }

  // The service holds the module's state, so a run after the new Activity's comes straight here.
  for (let waited = 0; waited < 20_000; waited += 100) {
    const now = await main(() => currentActivity()?.hashCode() ?? 0);
    if (now !== 0 && now !== recreated) {
      const said = `made again; ${await status()}`;
      console.log(`[lucent-media] outliveActivity: Activity ${now}, ${said}`);
      return said;
    }
    await delay(100);
  }
  console.log("[lucent-media] outliveActivity: no new Activity in 20 s");
  return "not made again";
}
