// What the view libraries' cases read from a component's native view (the
// Lab's Libraries screen, T121): the view React Native gave a testID
// (Android's tag, iOS's accessibilityIdentifier), its alpha, its size and
// the gesture recognizers on it and its parent, and on Android a tap at its
// middle, dispatched through the Activity's window as the system delivers
// one.
import { PLATFORM } from "lucent:platform";
import { main } from "lucent:thread";
import { UIApplication, UIWindowScene, type UIView } from "lucent:ios/UIKit";
import { currentActivity } from "lucent:android";
import { Rect } from "lucent:android/android.graphics";
import { SystemClock } from "lucent:android/android.os";
import { MotionEvent, ViewGroup, type View } from "lucent:android/android.view";

/**
 * The native view with `testID`: "alpha <a>, <w>x<h>" (pixels on Android,
 * points on iOS), and on iOS ", <n> recognizers": those on the view and on
 * its parent, where Gesture Handler 3's detector attaches its own. "no
 * view" when none has the testID.
 */
export async function viewFacts(testID: string): Promise<string> {
  if (PLATFORM === "android")
    return main(() => {
      const root = currentActivity()?.getWindow()?.getDecorView();
      const views: View[] = root ? [root] : [];
      while (views.length) {
        const view = views.pop()!;
        if (view.getTag()?.toString() === testID)
          return `alpha ${view.getAlpha().toFixed(1)}, ${view.getWidth()}x${view.getHeight()}`;
        if (view instanceof ViewGroup)
          for (let i = 0; i < view.getChildCount(); i++) {
            const child = view.getChildAt(i);
            if (child) views.push(child);
          }
      }
      return "no view";
    });

  return main(() => {
    const views: UIView[] = [];
    for (const scene of UIApplication.shared.connectedScenes)
      if (scene instanceof UIWindowScene) for (const window of scene.windows) views.push(window);
    while (views.length) {
      const view = views.pop()!;
      if (view.accessibilityIdentifier === testID) {
        const size = view.bounds.size;
        const recognizers =
          (view.gestureRecognizers?.length ?? 0) +
          (view.superview?.gestureRecognizers?.length ?? 0);
        return `alpha ${view.alpha.toFixed(1)}, ${Math.round(size.width)}x${Math.round(size.height)}, ${recognizers} recognizers`;
      }
      for (const subview of view.subviews) views.push(subview);
    }
    return "no view";
  });
}

/**
 * Taps the middle of the native view with `testID` (Android): a down and
 * an up, dispatched to the Activity's window as the system delivers them,
 * so what intercepts touches above the view (Gesture Handler's root) sees
 * them. "tapped", "no view", or "none" on iOS, where no API taps.
 */
export async function tapView(testID: string): Promise<string> {
  if (PLATFORM !== "android") return "none";

  return main(() => {
    const root = currentActivity()?.getWindow()?.getDecorView();
    const views: View[] = root ? [root] : [];
    let found: View | null = null;
    while (views.length && !found) {
      const view = views.pop()!;
      if (view.getTag()?.toString() === testID) found = view;
      else if (view instanceof ViewGroup)
        for (let i = 0; i < view.getChildCount(); i++) {
          const child = view.getChildAt(i);
          if (child) views.push(child);
        }
    }
    if (!found || !root) return "no view";

    // The view's rectangle in the window, which the window's touches are in.
    const rect = new Rect();
    if (!found.getGlobalVisibleRect(rect)) return "not visible";
    const x = rect.exactCenterX();
    const y = rect.exactCenterY();

    // Java's obtain() says nothing of null: it never gives one.
    const at = SystemClock.uptimeMillis();
    const down = MotionEvent.obtain(at, at, MotionEvent.ACTION_DOWN, x, y, 0)!;
    root.dispatchTouchEvent(down);
    down.recycle();
    const up = MotionEvent.obtain(at, at + 50n, MotionEvent.ACTION_UP, x, y, 0)!;
    root.dispatchTouchEvent(up);
    up.recycle();
    return "tapped";
  });
}
