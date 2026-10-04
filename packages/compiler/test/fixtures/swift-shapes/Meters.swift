// Swift shapes Lucent binds by rule (TA33): tuples, given and returned,
// labeled or not.
public final class Meter {
  public init() {}

  public func range() -> (Double, Double) {
    (1, 3)
  }

  public func span(_ r: (Double, Double)) -> Double {
    r.1 - r.0
  }

  public func bounds() -> (min: Int, max: Int) {
    (min: -1, max: 9)
  }

  public func state() -> (String, Bool) {
    ("on", true)
  }
}
