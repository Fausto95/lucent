package com.example.decl;

import android.annotation.NonNull;

/** A base whose contracts and members its subclass redeclares (Context, View, Vector, Thread). */
public abstract class Host {
  public Host() {}

  @NonNull
  public abstract Screen getScreen();

  @NonNull
  public static Host obtain() {
    return null;
  }

  public void layout(int left, int top) {}

  public boolean isEmpty() {
    return true;
  }

  /** A method beside the getter whose property it names (View's): no property is declared. */
  public boolean hasOverlappingRendering() {
    return true;
  }

  public boolean getHasOverlappingRendering() {
    return true;
  }
}
