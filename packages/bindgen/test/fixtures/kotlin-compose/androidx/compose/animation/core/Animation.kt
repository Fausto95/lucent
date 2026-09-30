package androidx.compose.animation.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.unit.Dp

interface AnimationSpec<T>

class SpringSpec<T>(val dampingRatio: Float, val stiffness: Float) : AnimationSpec<T>

fun <T> spring(dampingRatio: Float = 1f, stiffness: Float = 1500f, visibilityThreshold: T? = null): SpringSpec<T> =
  SpringSpec(dampingRatio, stiffness)

object Spring {
  const val StiffnessLow: Float = 200f
}

class AnimationVector1D

class AnimationResult<T, V>

class Animatable<T, V>(initialValue: T, val label: String = "Animatable") {
  val value: T
    get() = error("fixture")

  suspend fun animateTo(targetValue: T, animationSpec: AnimationSpec<T> = spring()): AnimationResult<T, V> =
    error("fixture")

  suspend fun snapTo(targetValue: T) {}
}

fun Animatable(initialValue: Float): Animatable<Float, AnimationVector1D> = Animatable(initialValue, "fixture")

@Composable
fun animateFloatAsState(
  targetValue: Float,
  animationSpec: AnimationSpec<Float> = spring(),
  finishedListener: ((Float) -> Unit)? = null,
): State<Float> = error("fixture")

@Composable
fun animateDpAsState(targetValue: Dp, animationSpec: AnimationSpec<Dp> = spring()): State<Dp> = error("fixture")
