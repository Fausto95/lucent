package com.example.widgets;

/** Narrows Store's Object result to a class: still a Java object. */
public class StoreChain extends ByteStore {
  public StoreChain() {}

  @Override
  public Store next() {
    return this;
  }
}
