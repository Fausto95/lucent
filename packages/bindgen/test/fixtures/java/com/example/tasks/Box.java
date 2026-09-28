package com.example.tasks;

/** A generic class holding a value in a field. */
public class Box<T> {
  public T value;

  public Box(T value) {
    this.value = value;
  }

  public void set(T value) {
    this.value = value;
  }

  /** A raw use of a generic class: its type arguments stay unknown. */
  @SuppressWarnings("rawtypes")
  public Result raw() {
    return null;
  }
}
