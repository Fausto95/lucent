package dev.lucent;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * Back presses for Lucent modules (onActivityEvent("backPressed")): a
 * callback on each AndroidX Activity's OnBackPressedDispatcher, the one way
 * an app targeting Android 16 hears them, since Activity.onBackPressed no
 * longer runs. Enabled only while a module listens, so that back works as
 * it would without Lucent otherwise; a press no module consumes goes on to
 * the callbacks added before it, as if this one were not there. Needs
 * AndroidX (LucentActivities finds it by name); everything here runs on the
 * main thread, but setWanted.
 */
final class LucentBack {
  private static final Handler main = new Handler(Looper.getMainLooper());
  /** The callbacks of the Activities still alive, to enable and disable. */
  private static final List<WeakReference<OnBackPressedCallback>> callbacks = new ArrayList<>();
  private static volatile boolean wanted;

  private LucentBack() {}

  static void attach(Activity a) {
    if (!(a instanceof ComponentActivity)) return;

    ComponentActivity activity = (ComponentActivity) a;
    WeakReference<ComponentActivity> held = new WeakReference<>(activity);
    OnBackPressedCallback callback =
        new OnBackPressedCallback(wanted) {
          @Override
          public void handleOnBackPressed() {
            ComponentActivity at = held.get();
            if (at == null || LucentActivities.backPressed(at)) return;

            // Not consumed: the press goes on as if Lucent were not there.
            setEnabled(false);
            at.getOnBackPressedDispatcher().onBackPressed();
            setEnabled(wanted);
          }
        };

    // Removed with the Activity's lifecycle.
    activity.getOnBackPressedDispatcher().addCallback(activity, callback);
    callbacks.removeIf(r -> r.get() == null);
    callbacks.add(new WeakReference<>(callback));
  }

  /** Whether a module listens for back presses: every callback follows, on the main thread. */
  static void setWanted(boolean on) {
    wanted = on;
    main.post(
        () -> {
          callbacks.removeIf(r -> r.get() == null);
          for (WeakReference<OnBackPressedCallback> r : callbacks) {
            OnBackPressedCallback c = r.get();
            if (c != null) c.setEnabled(wanted);
          }
        });
  }
}
