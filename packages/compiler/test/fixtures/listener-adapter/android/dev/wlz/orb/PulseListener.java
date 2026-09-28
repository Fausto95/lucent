package dev.wlz.orb;

/** Hears an orb's pulses, on the orb's thread, until its hook detaches. */
public interface PulseListener {
  void onPulse(double level);

  void onFailure(Exception error);
}
