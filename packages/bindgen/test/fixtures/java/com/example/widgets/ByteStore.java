package com.example.widgets;

/** Narrows Store's Object results to an array and a string: values, not Java objects. */
public class ByteStore extends Store {
  public ByteStore() {}

  @Override
  public byte[] contents() {
    return new byte[0];
  }

  @Override
  public String label() {
    return "bytes";
  }
}
