// Compiled, never run (android-children.test.ts): React Native mounts a
// view's children only through a manager that is an IViewGroupManager
// (SurfaceMountingManager.addViewAt casts to it), and lays them out itself
// only when that manager does not lay them out.
package dev.lucent;

import android.view.View;
import com.facebook.react.uimanager.IViewGroupManager;

final class ViewGroupManagerCheck {
  static void check(LucentViewManager manager, LucentHostView view, View child) {
    IViewGroupManager<LucentHostView> children = manager;

    children.addView(view, child, 0);
    children.removeViewAt(view, children.getChildCount(view) - 1);

    if (children.needsCustomLayoutForChildren()) throw new AssertionError();
  }
}
