package androidx.compose.runtime

import kotlinx.coroutines.CoroutineScope

/*
 * Compose's runtime as its API declares it, for the extraction tests: the
 * annotations its compiler plugin acts on, state, effects and remember.
 * Plain kotlinc compiles it (no Compose plugin): the facts come from the
 * annotations and the metadata.
 */

@Retention(AnnotationRetention.BINARY)
@Target(
  AnnotationTarget.FUNCTION,
  AnnotationTarget.TYPE,
  AnnotationTarget.TYPE_PARAMETER,
  AnnotationTarget.PROPERTY_GETTER,
)
annotation class Composable

@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY_GETTER, AnnotationTarget.TYPE)
annotation class ComposableTarget(val applier: String)

@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.FUNCTION)
annotation class ComposableInferredTarget(val scheme: String)

/** Marks an annotation that stands for a @ComposableTarget: its applier is the annotation's name. */
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.ANNOTATION_CLASS)
annotation class ComposableTargetMarker(val description: String = "")

@RequiresOptIn
@Retention(AnnotationRetention.BINARY)
annotation class ExperimentalComposeApi

interface State<out T> {
  val value: T
}

interface MutableState<T> : State<T> {
  override var value: T
}

fun <T> mutableStateOf(value: T): MutableState<T> = error("fixture")

@Composable inline fun <T> remember(calculation: () -> T): T = calculation()

@Composable
fun LaunchedEffect(key1: Any?, block: suspend CoroutineScope.() -> Unit) {}

@Composable
@Deprecated("give a key", level = DeprecationLevel.ERROR)
fun LaunchedEffect(block: suspend CoroutineScope.() -> Unit) {}

@Composable fun rememberCoroutineScope(): CoroutineScope = error("fixture")

class DisposableEffectResult

interface DisposableEffectScope {
  fun onDispose(onDisposeEffect: () -> Unit): DisposableEffectResult
}

@Composable
fun DisposableEffect(key1: Any?, effect: DisposableEffectScope.() -> DisposableEffectResult) {}

@ExperimentalComposeApi @Composable fun Experimental() {}

@Composable inline fun <reified T> rememberReified(): T? = null

fun keys(vararg inputs: Any?): Int = inputs.size

@Composable fun <T> rememberKept(vararg inputs: Any?, key: String? = null, init: () -> T): T = init()

/* Left empty, a vararg would call another overload: a refused one, or one of its own. */
@Composable
fun Keyed(vararg keys: Any?, block: suspend CoroutineScope.() -> Unit) {}

@Composable
@Deprecated("give a key", level = DeprecationLevel.ERROR)
fun Keyed(block: suspend CoroutineScope.() -> Unit) {}

@Composable inline fun <T> keep(calculation: () -> T): T = calculation()

@Composable inline fun <T> keep(vararg keys: Any?, calculation: () -> T): T = calculation()

val currentCompositeKey: Int
  @Composable get() = 0

fun readFrom(file: java.io.File): Int = 0
