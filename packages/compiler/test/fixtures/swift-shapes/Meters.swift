// Swift shapes Lucent binds by rule (TA33): tuples, given and returned,
// labeled or not; and closures, given (escaping or not) and returned.
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

  public func adder(_ n: Double) -> (Double) -> Double {
    { $0 + n }
  }

  public func apply(_ f: @escaping (Double) -> Double) -> Double {
    f(2)
  }

  public func each(_ values: [Double], _ f: (Double) -> Void) {
    values.forEach(f)
  }

  public func greet(_ name: String, _ f: (String) -> String) -> String {
    f(name)
  }
}
