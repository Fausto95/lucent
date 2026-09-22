data class User(
  var id: String,
  var age: Int,
  var nickname: String?,
  var tags: MutableList<String>
)

fun birthday(user: User): User {
  return User(id = user.id, age = user.age + 1, nickname = user.nickname, tags = user.tags)
}

fun describe(user: User): String {
  val nickname: String? = user.nickname
  if (nickname == null) {
    return user.id + " (" + lucentStr(user.age) + ")"
  }
  return nickname!! + " aka " + user.id
}
