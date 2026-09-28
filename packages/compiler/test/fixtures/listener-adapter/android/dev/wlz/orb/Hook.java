package dev.wlz.orb;

/** Stops a listener. Detaching twice does nothing. */
public final class Hook {
  private volatile PulseListener listener;

  Hook(PulseListener listener) {
    this.listener = listener;
  }

  public void detach() {
    listener = null;
  }

  public boolean isAttached() {
    return listener != null;
  }

  PulseListener listener() {
    return listener;
  }
}
