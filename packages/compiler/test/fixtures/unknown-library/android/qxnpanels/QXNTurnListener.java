package dev.qxn.panels;

/** Hears a gauge turned: one method, so a gauge's turns are an event by convention. */
public interface QXNTurnListener {
  void onQXNTurn(QXNReading reading, int steps);
}
