import Foundation

/// A Swift library as a package ships it: the roadmap's Search API, and
/// protocols whose requirements Lucent classes implement.

// MARK: - Search

/// One result: a Swift value, boxed in Lucent.
public struct SearchHit {
  public let title: String
  public var score: Double

  public init(title: String, score: Double = 1) {
    self.title = title
    self.score = score
  }
}

public enum SearchError: Error {
  case badQuery
}

private let catalog = ["orbit", "orange", "origin", "ocean", "planet"]

/// Searches the catalog: async, throwing, with a default Swift fills in.
public final class SearchClient {
  public private(set) var searches = 0

  public init() {}

  public func search(_ prefix: String, limit: Int = 20) async throws -> [SearchHit] {
    searches += 1
    guard prefix != "!" else { throw SearchError.badQuery }

    return catalog.filter { $0.hasPrefix(prefix) }.prefix(limit).map { SearchHit(title: $0) }
  }

  /// Newer than the apps' oldest iOS: used only where the program checked the OS.
  @available(iOS 17.0, macOS 14.0, *)
  public func recent() -> [String] {
    ["orbit"]
  }

  /// Waits `seconds` first; a cancelled task stops waiting and throws.
  public func slowSearch(_ prefix: String, seconds: Double) async throws -> [SearchHit] {
    try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))

    return try await search(prefix)
  }
}

/// A Swift class a Swift subclass could extend.
open class Feed {
  public init() {}

  open func next() -> String {
    "orbit"
  }
}

// MARK: - Requirements

/// Properties, throwing, async and mutating requirements.
public protocol Source {
  var name: String { get }
  var limit: Double { get set }

  func titles() throws -> [String]
  func fetch(_ prefix: String) async throws -> [String]
  func count() async -> Double
  mutating func reset()
}

/// What Swift reads from a source through its requirements.
public enum Sources {
  public static func describe(_ source: Source) -> String {
    "\(source.name) \(source.limit)"
  }

  public static func raise(_ source: Source, to limit: Double) -> Double {
    var s = source
    s.limit = limit
    return s.limit
  }

  public static func titles(_ source: Source) -> String {
    do {
      return try source.titles().joined(separator: " ")
    } catch {
      return "failed: \((error as NSError).localizedDescription)"
    }
  }

  public static func fetch(_ source: Source, _ prefix: String) async throws -> String {
    let titles = try await source.fetch(prefix)
    let count = await source.count()

    return "\(titles.joined(separator: " ")) of \(count)"
  }

  public static func reset(_ source: Source) {
    var s = source
    s.reset()
  }
}

/// An associated type, which the implementation fixes.
public protocol Store<Item> {
  associatedtype Item

  func load() -> Item?
  @discardableResult func save(_ item: Item) -> Bool
}

/// A store Swift uses through a generic parameter.
public enum Stores {
  public static func swap(_ store: some Store<String>, _ item: String) -> String {
    let old = store.load() ?? "none"
    store.save(item)

    return old
  }
}

/// Self in a requirement: another value of the implementing type.
public protocol Ranked {
  func outranks(_ other: Self) -> Bool
  func best() -> Self
}

public enum Ranking {
  /// Whether a ranked value's best outranks it: Swift opens the value it is given.
  public static func improves(_ ranked: some Ranked) -> Bool {
    ranked.best().outranks(ranked)
  }
}

/// A requirement Swift would construct the implementing type with.
public protocol Blank {
  init()
}
