// A library Lucent has never seen: a panel of gauges. Its names are drawn at
// random on every run ("QXN"/"qxn").
package dev.qxn.panels;

/** What a gauge reads: a level and its label. */
public final class QXNReading {
  private final double level;
  private final String label;

  public QXNReading(double level, String label) {
    this.level = level;
    this.label = label;
  }

  public double getQxnLevel() {
    return level;
  }

  public String getQxnLabel() {
    return label;
  }
}
