func pick(value: Double) throws -> Double {
  return (value * 2.0)
}

func choose(flag: Bool) throws -> Double {
  let chosen: Double = (flag ? pick(value: 1.0) : pick(value: 2.0))
  return chosen
}

func nested(flag: Bool, other: Bool) throws -> Double {
  return (flag ? pick(value: 3.0) : (other ? pick(value: 4.0) : 5.0))
}
