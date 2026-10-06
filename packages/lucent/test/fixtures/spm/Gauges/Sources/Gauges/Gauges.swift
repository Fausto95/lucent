/// A gauge whose readings came with later iOS versions.
public final class Gauge {
  public var level: Double

  public init(level: Double) {
    self.level = level
  }

  /// As old as the app's deployment target: callable as it is.
  @available(iOS 16.4, *)
  public func steady() -> Double {
    level
  }

  /// Newer than the app's deployment target: callable under a check.
  @available(iOS 17.0, *)
  public func doubled() -> Double {
    level * 2
  }
}
