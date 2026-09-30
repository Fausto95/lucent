package dev.orbit.ticker

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.withContext

/** An interface with a default method, which implementers may leave out and callers call. */
interface Source {
  val name: String

  fun describe(): String = "source $name"
}

/**
 * Streams as Kotlin libraries expose them: cold flows that complete, fail
 * or never end, a state flow, and suspend functions taking suspend
 * functions.
 */
class Ticker {
  private val stopped = AtomicInteger()

  private val current = MutableStateFlow("idle")

  /** How many of this ticker's flows a cancellation has stopped. */
  val cancelled: Int
    get() = stopped.get()

  /** The latest label: a flow that never completes, and starts with the current value. */
  val state: StateFlow<String> = current.asStateFlow()

  /** 1 to `to`, `gap` milliseconds apart. */
  fun count(to: Int, gap: Long = 0): Flow<Int> =
    flow {
        for (i in 1..to) {
          if (gap > 0) delay(gap)
          emit(i)
        }
      }
      .onCompletion { if (it is CancellationException) stopped.incrementAndGet() }

  /** Emits `first`, then fails. */
  fun failing(first: String): Flow<String> = flow {
    emit(first)
    throw IllegalStateException("broken after $first")
  }

  /** Ticks every `gap` milliseconds until cancelled. */
  fun forever(gap: Long = 5): Flow<Int> =
    flow {
        var i = 0
        while (true) {
          emit(i++)
          delay(gap)
        }
      }
      .onCompletion { if (it is CancellationException) stopped.incrementAndGet() }

  /** This ticker as a source. */
  fun source(): Source =
    object : Source {
      override val name = "ticker"
    }

  fun label(value: String) {
    current.value = value
  }

  /** Runs `step` on each of `values` in turn, each once the previous one has returned. */
  suspend fun each(values: List<String>, step: suspend (String) -> Unit): Int {
    for (v in values) step(v)
    return values.size
  }

  /** `transform` of `value`, run on another thread. */
  suspend fun transformed(value: String, transform: suspend (String) -> String): String =
    withContext(Dispatchers.Default) { transform(value) }
}
