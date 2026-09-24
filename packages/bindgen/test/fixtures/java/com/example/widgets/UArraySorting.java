package com.example.widgets;

/**
 * Kotlin mangles the JVM names of functions taking inline classes
 * (sortArray-4UcCI2c): the test patches `$` to `-` in the class file,
 * which javac cannot write.
 */
public final class UArraySorting {
  public static void sortArray$4UcCI2c(byte[] array, int from, int to) {}
  public static void sort$all(int[] array) {}
}
