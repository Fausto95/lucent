package dev.orbit.interop;

/** A Java class extending a Kotlin class, overriding a method without annotations. */
public class JavaOnKotlin extends KotlinBase {
  @Override
  public String label(String prefix) {
    return prefix;
  }
}
