package com.example.widgets;

import android.annotation.NonNull;

/** Constants grouped by @IntDef and @StringDef in annotations.zip, as the SDK groups them. */
public class Gauge {
  public static final int MODE_FAST = 1;
  public static final int MODE_SLOW = 2;
  public static final String UNIT_KM = "km";
  public static final String UNIT_MI = "mi";
  public static final int FLAG_A = 1;
  public static final int FLAG_B = 2;
  public static final long WINDOW_SHORT = 1L;
  public static final long WINDOW_LONG = 60000L;

  public Gauge() {}

  public void setMode(int mode) {}

  public int getMode() {
    return MODE_FAST;
  }

  public void setUnit(String unit) {}

  public void setFlags(int flags) {}

  public void setSpeed(int speed, int mode) {}

  public void setWindow(long window) {}

  public long elapsed() {
    return 0L;
  }

  @NonNull
  public String label() {
    return "gauge";
  }
}
