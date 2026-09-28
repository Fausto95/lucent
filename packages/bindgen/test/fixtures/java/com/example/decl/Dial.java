package com.example.decl;

import com.example.widgets.Gauge;

/** Overrides a method of another package's class, whose @IntDef that package's annotations give. */
public class Dial extends Gauge {
  public Dial() {}

  @Override
  public int getMode() {
    return MODE_SLOW;
  }
}
