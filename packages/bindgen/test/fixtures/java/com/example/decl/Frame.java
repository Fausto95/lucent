package com.example.decl;

import android.annotation.Nullable;

/**
 * Redeclares Host's members: a @Nullable override of a non-null result
 * (ContextWrapper.getDisplay), a hiding static without annotations
 * (AccessibilityEvent.obtain), a getter whose property would be named like
 * Host's method layout (TextView.getLayout), and a method named like the
 * property Host's isEmpty gives (Stack.empty); and an override of a
 * method Host declares beside a getter of its name (ImageView's
 * hasOverlappingRendering), which keeps it.
 */
public class Frame extends Host {
  public Frame() {}

  @Nullable
  @Override
  public Screen getScreen() {
    return null;
  }

  public static Frame obtain() {
    return null;
  }

  public String getLayout() {
    return "";
  }

  public boolean empty() {
    return true;
  }

  @Override
  public boolean hasOverlappingRendering() {
    return false;
  }
}
