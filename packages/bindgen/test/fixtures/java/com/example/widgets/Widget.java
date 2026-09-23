package com.example.widgets;

import android.annotation.NonNull;
import android.annotation.Nullable;
import com.example.base.Shape;

public class Widget implements Shape {
  public static final int KIND_SMALL = 1;
  public static final String DEFAULT_NAME = "widget";
  public static int counter;

  public Widget() {}
  public Widget(@NonNull String name) {}
  Widget(int hidden) {}

  public double area() { return 0; }
  @NonNull public String getName() { return ""; }
  public boolean isEnabled() { return true; }
  @Nullable public String getLabel() { return null; }
  public String getURL() { return ""; }
  public void setValue(int v) {}
  public void setValue(long v) {}
  public void setValue(@NonNull String v) {}
  public byte[] getBytes() { return new byte[0]; }
  @NonNull public CharSequence getTitle() { return ""; }
  public void setTitle(@Nullable CharSequence title) {}
  public static @NonNull Widget create(long[] sizes, int count) { return new Widget(); }
  public <T> T get(@NonNull Class<T> type) { return null; }
  public <T extends Shape> T shape(@NonNull Class<T> type) { return null; }
  public java.util.List<String> names() { return null; }
  @Deprecated public void old() {}
  public void touch(@NonNull Shape s, @Nullable Widget other) {}
  private void secret() {}

  public static class Config {
    public static final long TIMEOUT = 30L;
    public Config() {}
  }

  public abstract static class Listener {
    public abstract void onChange(@NonNull Widget w);
  }
}
