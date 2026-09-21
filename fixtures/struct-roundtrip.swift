struct User {
  var id: String
  var age: Int32
  var nickname: String?
  var tags: [String]
}

func birthday(user: User) throws -> User {
  return User(id: user.id, age: (user.age &+ 1), nickname: user.nickname, tags: user.tags)
}

func describe(user: User) throws -> String {
  let nickname: String? = user.nickname
  if nickname == nil {
    return user.id + " (" + lucentStr(user.age) + ")"
  }
  return nickname! + " aka " + user.id
}
