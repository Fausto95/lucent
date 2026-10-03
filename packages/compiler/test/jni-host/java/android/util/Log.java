// The desktop JNI host's stand-in for android.util.Log: what Lucent's
// runtime classes write to it, on standard error.
package android.util;

public final class Log {
  public static int e(String tag, String message, Throwable error) {
    System.err.println(tag + ": " + message + ": " + error);
    return 0;
  }
}
