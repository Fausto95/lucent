// The library's dependency, a jar of its own: a type the library's
// signatures name ("QXN"/"qxn" is replaced on every run).
package dev.qxn.core

class QXNUnit(val qxnSymbol: String) {
  fun qxnFormat(value: Double): String = "$value $qxnSymbol"
}
