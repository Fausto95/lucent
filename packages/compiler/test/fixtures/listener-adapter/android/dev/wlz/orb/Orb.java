package dev.wlz.orb;

import java.util.ArrayList;
import java.util.List;

/** A listener API with names nothing in Lucent knows: it reports pulses from a thread of its own. */
public final class Orb {
  private final String label;
  private final List<Hook> hooks = new ArrayList<>();

  public Orb(String label) {
    this.label = label;
  }

  public synchronized Hook attach(PulseListener listener) {
    Hook hook = new Hook(listener);
    hooks.add(hook);
    return hook;
  }

  /** Reports the levels 1 to `count` from another thread, then fails if `breaks`. */
  public void emitPulses(double count, boolean breaks) {
    new Thread(() -> {
      for (int level = 1; level <= (int) count; level++) {
        for (Hook hook : snapshot()) {
          PulseListener l = hook.listener();
          if (l != null) l.onPulse(level);
        }
      }
      if (!breaks) return;
      Exception broken = new IllegalStateException("the orb broke");
      for (Hook hook : snapshot()) {
        PulseListener l = hook.listener();
        if (l != null) l.onFailure(broken);
      }
    }, label).start();
  }

  public synchronized double attachedCount() {
    double n = 0;
    for (Hook hook : hooks) n += hook.isAttached() ? 1 : 0;
    return n;
  }

  private synchronized List<Hook> snapshot() {
    return new ArrayList<>(hooks);
  }
}
