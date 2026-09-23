package com.example.widgets;

import android.annotation.NonNull;

/** One abstract method: a function can implement it. */
public interface OnEvent {
  void onEvent(@NonNull String name, int count);
  default void reset() {}
  boolean equals(Object other);
}
