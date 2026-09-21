data class Progress(
  var percent: Double,
  var label: String
)

fun __event_253846265b0a3b85_progress(payload: Progress): Unit {
  LucentEventHub.emit("__event_253846265b0a3b85_progress", mapOf("percent" to payload.percent, "label" to payload.label))
}

fun report(percent: Double): Unit {
  __event_253846265b0a3b85_progress(Progress(percent = percent, label = "native"))
}
