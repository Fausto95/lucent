package com.example.tasks;

public interface Mapper<A, B> {
  B apply(A value);
}
