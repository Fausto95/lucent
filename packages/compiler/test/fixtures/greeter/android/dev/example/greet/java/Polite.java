package dev.example.greet.java;

import dev.example.greet.Greeter;

/** Java beside the Kotlin, calling it: compiled after it, against its classes. */
public final class Polite {
  private Polite() {}

  public static String greet(Greeter greeter) {
    return "please, " + greeter.getName();
  }
}
