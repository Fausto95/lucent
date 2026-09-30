package com.example.widgets;

/** Overrides without annotations of its own: they keep Gauge's non-null label and @IntDef mode. */
public class FastGauge extends Gauge {
  public FastGauge() {}

  @Override
  public int getMode() {
    return MODE_FAST;
  }

  @Override
  public String label() {
    return "fast";
  }
}
