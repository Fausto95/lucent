package com.google.android.gms.tasks;

import android.annotation.NonNull;

/** The part of Play services' Task that await uses. */
public abstract class Task<TResult> {
  public abstract boolean isSuccessful();

  public abstract TResult getResult();

  public abstract Exception getException();

  /** Takes a class the caller may pass as null, as getCurrentLocation does. */
  @NonNull
  public Task<TResult> withToken(CancellationToken token) {
    return this;
  }

  @NonNull
  public Task<TResult> addOnCompleteListener(@NonNull OnCompleteListener<TResult> listener) {
    return this;
  }
}
