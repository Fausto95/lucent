package com.example.tasks;

import android.annotation.NonNull;

/** A generic class whose members use its type parameter, as Play services' Task does. */
public abstract class Result<T> {
  public abstract boolean isDone();

  public abstract T get();

  @NonNull
  public abstract Result<T> onDone(@NonNull Listener<? super T> listener);

  @NonNull
  public <R> Result<R> map(@NonNull Mapper<? super T, ? extends R> mapper) {
    return null;
  }

  @NonNull
  public static <V> Result<V> of(V value) {
    return null;
  }
}
