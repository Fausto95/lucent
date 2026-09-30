package com.example.decl;

/** A result typed by a variable bounded by what it overrides returns (Spliterator.OfPrimitive.trySplit). */
public interface PrimitiveSplitter<T, S extends PrimitiveSplitter<T, S>> extends Splitter<T> {
  @Override
  S split();

  int size();
}
