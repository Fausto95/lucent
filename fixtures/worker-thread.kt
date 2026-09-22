suspend fun summarize(values: MutableList<Double>): Double {
  return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
    var total: Double = 0.0
    for (value in values) {
      total = (total + value)
    }
    return@withContext total
  }
}

suspend fun label(count: Double): String {
  return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
    return@withContext "count: " + lucentStr(count)
  }
}
