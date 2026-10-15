package android.view;

import android.content.Context;

/** A stand-in for Android's View: made with a context, which it gives back (jni_test.cpp). */
public class View {
  private final Context context;

  public View(Context context) {
    this.context = context;
  }

  public final Context getContext() {
    return context;
  }
}
