package com.google.android.gms.tasks;

/** Play services' CancellationToken: in descriptors of methods that take one. */
public abstract class CancellationToken {
  public abstract boolean isCancellationRequested();
}
