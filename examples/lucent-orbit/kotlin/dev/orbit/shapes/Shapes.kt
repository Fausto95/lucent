package dev.orbit.shapes

import kotlin.math.PI

/** A value class: the JVM passes a Double where Kotlin sees Meters. */
@JvmInline
value class Meters(val value: Double)

/** A sealed hierarchy whose cases carry their payloads as properties. */
sealed interface Shape {
  val area: Double
}

data class Circle(val radius: Double) : Shape {
  override val area: Double
    get() = PI * radius * radius
}

data class Rect(val width: Double, val height: Double = width) : Shape {
  override val area: Double
    get() = width * height
}

object Empty : Shape {
  override val area: Double
    get() = 0.0
}

/** A top-level function over the sealed cases. */
fun describe(shape: Shape): String =
  when (shape) {
    is Circle -> "circle ${shape.radius}"
    is Rect -> "rect ${shape.width}x${shape.height}"
    Empty -> "empty"
  }

/** An extension with a default, taking its receiver first on the JVM. */
fun Shape.scaled(factor: Double = 2.0): Shape =
  when (this) {
    is Circle -> Circle(radius * factor)
    is Rect -> Rect(width * factor, height * factor)
    Empty -> Empty
  }

/** Takes and gives value classes, which the JVM unboxes. */
fun perimeter(shape: Shape): Meters =
  Meters(
    when (shape) {
      is Circle -> 2 * PI * shape.radius
      is Rect -> 2 * (shape.width + shape.height)
      Empty -> 0.0
    },
  )

fun circleOf(radius: Meters): Circle = Circle(radius.value)

/** An extension on a value class. */
fun Meters.feet(): Double = value * 3.28084

/** A top-level property with a setter. */
var unit: String = "m"
