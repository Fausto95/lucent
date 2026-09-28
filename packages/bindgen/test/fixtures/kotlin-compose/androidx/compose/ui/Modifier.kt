package androidx.compose.ui

import androidx.compose.runtime.ComposableTargetMarker
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Retention(AnnotationRetention.BINARY)
@ComposableTargetMarker(description = "UI Composable")
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY_GETTER, AnnotationTarget.TYPE, AnnotationTarget.TYPE_PARAMETER)
annotation class UiComposable

interface Modifier {
  fun then(other: Modifier): Modifier = other

  companion object : Modifier
}

fun Modifier.padding(all: Dp): Modifier = this

fun Modifier.offset(x: Dp = 0.dp, y: Dp = 0.dp): Modifier = this

fun Modifier.clickable(enabled: Boolean = true, onClick: () -> Unit): Modifier = this

fun Modifier.scale(scale: Float): Modifier = this

fun Modifier.onSized(onSize: (Int) -> Unit): Modifier = this

interface Alignment {
  interface Horizontal

  companion object {
    val CenterHorizontally: Horizontal = object : Horizontal {}
  }
}

@JvmInline
value class Color(val value: ULong) {
  companion object {
    val White: Color = Color(0xffffffff)
  }
}

fun Color(color: Long): Color = Color(color.toULong())

fun Color(color: Int): Color = Color(color.toLong())
