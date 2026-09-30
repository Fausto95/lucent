package com.example.decl;

/**
 * Narrows Source's Object results to a type variable and to an interface,
 * which TypeScript cannot relate to Java's Object (ArrayAdapter<T>.getItem,
 * CursorTreeAdapter.getChild); label narrows to a class, which it can.
 */
public abstract class Rows<T> implements Source {
  public Rows() {}

  @Override
  public abstract T item(int position);

  @Override
  public abstract Cursorish child();

  @Override
  public abstract Screen label();
}
