package dev.qxn.panels;

import android.content.Context;
import android.view.View;

/** A gauge: its reading, marks and label set one by one, its turns heard by a listener. */
public class QXNGauge extends View {
  private QXNReading reading = new QXNReading(0, "");
  private double[] marks = new double[0];
  private String label = "";
  private QXNTurnListener listener;

  public QXNGauge(Context context) {
    super(context);
  }

  public void setQxnReading(QXNReading reading) {
    this.reading = reading;
  }

  public void setQxnMarks(double[] marks) {
    this.marks = marks;
  }

  public void setQxnLabel(String label) {
    this.label = label;
  }

  public void setOnQXNTurnListener(QXNTurnListener listener) {
    this.listener = listener;
  }

  /** Turns the gauge by `steps`, as a user would. */
  public void qxnTurn(int steps) {
    if (listener != null)
      listener.onQXNTurn(new QXNReading(reading.getQxnLevel() + steps, label), steps);
  }
}
