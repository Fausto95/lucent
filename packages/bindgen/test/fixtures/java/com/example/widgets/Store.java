package com.example.widgets;

/** Results typed Object, which subclasses narrow: to values (ByteStore) or to a class (StoreChain). */
public abstract class Store {
  public abstract Object contents();

  public Object label() {
    return "store";
  }

  public Object next() {
    return null;
  }
}
