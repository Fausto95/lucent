package androidx.compose.foundation.layout

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ComposableInferredTarget
import androidx.compose.runtime.ComposableTarget
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.UiComposable

interface BoxScope {
  fun Modifier.align(alignment: Alignment): Modifier
}

interface ColumnScope

@Composable
@ComposableTarget(applier = "androidx.compose.ui.UiComposable")
fun Box(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {}

@Composable
@ComposableTarget(applier = "androidx.compose.ui.UiComposable")
fun Box(modifier: Modifier) {}

@Composable
@ComposableInferredTarget(scheme = "[androidx.compose.ui.UiComposable[androidx.compose.ui.UiComposable]]")
inline fun Column(
  modifier: Modifier = Modifier,
  horizontalAlignment: Alignment.Horizontal = Alignment.CenterHorizontally,
  content: @Composable ColumnScope.() -> Unit,
) {}

@Composable
@ComposableTarget(applier = "androidx.compose.ui.UiComposable")
fun ColumnScope.Spaced(content: @Composable () -> Unit) {}

@Composable
@ComposableTarget(applier = "androidx.compose.ui.graphics.vector.VectorComposable")
fun VectorGroup(name: String = "") {}

@Composable
@ComposableTarget(applier = "androidx.compose.ui.UiComposable")
fun Labeled(label: @Composable () -> Unit, text: String) {}

/** Composes into whatever its content does (an applier variable): its caller's, here UI. */
@Composable
@ComposableInferredTarget(scheme = "[0[0]]")
fun Provide(content: @Composable () -> Unit) {}

fun <T> T.also2(): T = this

fun List<Int>.total(): Int = sum()

/** A UI composable marked with its applier's marker annotation. */
@Composable
@UiComposable
fun Measured(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {}

/**
 * A value and the callback of its changes (a signal binds both), a
 * collection, and a defaulted parameter of a type content cannot write
 * (left to its default).
 */
@Composable
@ComposableTarget(applier = "androidx.compose.ui.UiComposable")
fun Field(
  value: String,
  onValueChange: (String) -> Unit,
  counts: Collection<Int> = emptyList(),
  decoration: @Composable (inner: @Composable () -> Unit) -> Unit = { it() },
) {}
