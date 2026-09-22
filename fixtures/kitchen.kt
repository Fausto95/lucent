data class Stats(
  var count: Int,
  var labels: Map<String, String>,
  var values: MutableList<Double>
)

fun label(stats: Stats, key: String): String {
  val found: String? = stats.labels[key]
  if (found != null) {
    return found!!
  }
  return "none"
}

fun bumpCount(stats: Stats): Int {
  var stats: Stats = stats
  stats.count = stats.count + 1
  return stats.count
}

fun summarize(stats: Stats, key: String, verbose: Boolean): String {
  var out: String = label(stats, key)
  var i: Int = 0
  while (i < stats.count) {
    out = out + "!"
    i = i + 1
  }
  var evens: MutableList<Double> = mutableListOf<Double>()
  for (v in stats.values) {
    if (v % 2.0 == 0.0 && v > 0.0) {
      evens.add(v)
    } else {
      if (v < 0.0) {
        break
      } else {
        continue
      }
    }
  }
  if (!verbose || evens.size.toDouble() == 0.0) {
    return out
  }
  return out + " " + lucentStr(evens.size.toDouble()) + " " + lucentStr(-i)
}
