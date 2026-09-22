class LucentError(val code: String, message: String? = null, val metadata: Map<String, Any?> = emptyMap()) : Exception(message ?: code)
