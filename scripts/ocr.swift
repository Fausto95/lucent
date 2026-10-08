// The text in an image, top to bottom, one line each: what a device run's screenshot shows,
// for scripts/device-check.ts on macOS (Vision's text recognition).
//   xcrun swift scripts/ocr.swift screen.png
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
try VNImageRequestHandler(url: url).perform([request])
let lines = (request.results ?? [])
  .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
  .compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
