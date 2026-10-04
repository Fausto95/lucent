// Initializers TypeScript cannot tell apart: each takes one String, and
// only their argument labels say which is which (as KeychainAccess's
// `init(service:)` and `init(accessGroup:)` do).
public final class Vault {
  public let service: String
  public let accessGroup: String

  public init() {
    service = "default"
    accessGroup = ""
  }

  public init(service: String) {
    self.service = service
    accessGroup = ""
  }

  public init(accessGroup: String) {
    service = "default"
    self.accessGroup = accessGroup
  }
}

// One of them unlabeled: what Swift itself calls with a bare argument
// (`Badge("n")`, as `Locale.LanguageCode("en")`).
public final class Badge {
  public let text: String

  public init(_ name: String) {
    text = "name \(name)"
  }

  public init(code: String) {
    text = "code \(code)"
  }
}
