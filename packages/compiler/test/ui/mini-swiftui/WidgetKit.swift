// A miniature of WidgetKit for the host (mini-swiftui.ts): the shapes a
// widget's generated Swift uses (decision 0124): an entry, a timeline
// provider, a timeline and its reload policy, a static configuration and
// its modifiers, a widget and a bundle. It declares what tests use, not
// WidgetKit.
import Foundation
import SwiftUI

public protocol TimelineEntry {
  var date: Date { get }
}

public struct TimelineProviderContext {}

public enum TimelineReloadPolicy {
  case atEnd
  case never
  case after(Date)
}

public struct Timeline<EntryType: TimelineEntry> {
  public init(entries: [EntryType], policy: TimelineReloadPolicy) {}
}

public protocol TimelineProvider {
  associatedtype Entry: TimelineEntry
  typealias Context = TimelineProviderContext
  func placeholder(in context: Context) -> Entry
  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void)
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void)
}

public enum WidgetFamily {
  case systemSmall
  case systemMedium
  case systemLarge
  case systemExtraLarge
  case accessoryCircular
  case accessoryRectangular
  case accessoryInline
}

public protocol WidgetConfiguration {}

public struct ModifiedConfiguration: WidgetConfiguration {}

extension WidgetConfiguration {
  public func configurationDisplayName(_ displayName: String) -> some WidgetConfiguration {
    ModifiedConfiguration()
  }
  public func description(_ description: String) -> some WidgetConfiguration {
    ModifiedConfiguration()
  }
  public func supportedFamilies(_ families: [WidgetFamily]) -> some WidgetConfiguration {
    ModifiedConfiguration()
  }
}

public struct StaticConfiguration<Content: View>: WidgetConfiguration {
  public init<Provider: TimelineProvider>(
    kind: String,
    provider: Provider,
    @ViewBuilder content: @escaping (Provider.Entry) -> Content
  ) {}
}

public protocol Widget {
  associatedtype Body: WidgetConfiguration
  init()
  var body: Body { get }
}

@resultBuilder
public struct WidgetBundleBuilder {
  public static func buildBlock<W: Widget>(_ w: W) -> W { w }
}

public protocol WidgetBundle {
  associatedtype Body: Widget
  init()
  @WidgetBundleBuilder var body: Body { get }
}

extension WidgetBundle {
  public static func main() {}
}
