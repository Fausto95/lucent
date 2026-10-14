// A background download, as expo-file-system's background sessions make
// one, with no JavaScript: iOS downloads while the app is suspended or
// ended, and starts the app again to hand it the session's events. A
// launch module subscribes to `backgroundURLSession` while the app
// launches, makes the session again by its identifier, and calls `done`
// once the events have arrived (urlSessionDidFinishEvents), which lets iOS
// suspend the app again. Each step is logged as a LUCENT_DOWNLOAD line,
// which the device runs look for after ending the app mid-download.
import { PLATFORM } from "lucent:platform";
import { onAppEvent } from "lucent:ios";
import {
  NSURL,
  URLSession,
  URLSessionConfiguration,
  type URLSessionDelegate,
  type URLSessionDownloadDelegate,
  type URLSessionDownloadTask,
  type URLSessionTask,
} from "lucent:ios/Foundation";

/** The background session's identifier. */
export const SESSION = "dev.lucent.example.downloads";

let downloaded = 0;
let failed = 0;
// What iOS waits for once the session's events have arrived: `done` of the launch's subscriber.
let delivered: (() => void) | null = null;
let session: URLSession | null = null;

/**
 * The session's delegate: it hears each download, then the end of the events
 * iOS held. The session takes a URLSessionDelegate, which it names too.
 */
class Downloads implements URLSessionDelegate, URLSessionDownloadDelegate {
  urlSession_downloadTask_didFinishDownloadingTo(
    _session: URLSession,
    _task: URLSessionDownloadTask,
    location: NSURL,
  ): void {
    downloaded++;
    console.log(`LUCENT_DOWNLOAD finished ${location.lastPathComponent ?? "a file"}`);
  }

  urlSession_task_didCompleteWithError(
    _session: URLSession,
    _task: URLSessionTask,
    error: Error | null,
  ): void {
    if (!error) return;
    failed++;
    console.log(`LUCENT_DOWNLOAD failed: ${error.message}`);
  }

  urlSessionDidFinishEvents_forBackgroundURLSession(_session: URLSession): void {
    console.log(`LUCENT_DOWNLOAD events delivered: ${downloaded} finished, ${failed} failed`);
    const done = delivered;
    delivered = null;
    done?.();
  }
}

/** The background session, made once per process: again, by its identifier, in one iOS started. */
function background(): URLSession {
  session ??= new URLSession(URLSessionConfiguration.background(SESSION), new Downloads(), null);
  return session;
}

// At launch: iOS hands a process it started for the session its events once launch is over.
const listening = listen();

function listen(): boolean {
  if (PLATFORM !== "ios") return false;

  onAppEvent("backgroundURLSession", (identifier, done) => {
    if (identifier !== SESSION) return false;
    console.log(`LUCENT_DOWNLOAD relaunched for ${identifier}`);
    delivered = done;
    background();
    return true;
  });
  return true;
}

/**
 * Starts downloading `url` in the background session (iOS): "started", or
 * why not. "none" on Android.
 */
export function download(url: string): string {
  if (PLATFORM !== "ios") return "none";
  if (!listening) return "not listening";

  const target = NSURL.string(url);
  if (!target) return `${url} is not a URL`;
  background().downloadTask(target).resume();
  return "started";
}

/** What the session finished in this process: "1 finished, 0 failed". */
export function downloads(): string {
  return `${downloaded} finished, ${failed} failed`;
}
