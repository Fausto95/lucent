fun <Value> lucentKeyedRows(values: List<Value>, key: (Value) -> String): List<Pair<String, Value>> {
  val seen = HashSet<String>()
  return values.mapIndexed { index, value ->
    val raw = key(value)
    var id = raw
    if (!seen.add(id)) {
      id = "$raw#$index"
      seen.add(id)
    }
    Pair(id, value)
  }
}
