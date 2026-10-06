// swift-tools-version:5.9
// A Swift package an app adds in Xcode (TA32): Lucent builds it for the
// app's deployment target, and binds it by rule.
import PackageDescription

let package = Package(
  name: "Gauges",
  platforms: [.iOS("15.1")],
  products: [.library(name: "Gauges", targets: ["Gauges"])],
  targets: [.target(name: "Gauges")]
)
