struct Progress {
  var percent: Double
  var label: String
}

func __event_253846265b0a3b85_progress(payload: Progress) throws -> Void {
  try LucentEventHub.shared.emit("__event_253846265b0a3b85_progress", ["percent": payload.percent, "label": payload.label] as [String: Any])
}

func report(percent: Double) throws -> Void {
  _ = try __event_253846265b0a3b85_progress(payload: Progress(percent: percent, label: "native"))
}
