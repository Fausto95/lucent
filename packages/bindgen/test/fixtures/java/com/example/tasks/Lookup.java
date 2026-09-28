package com.example.tasks;

import android.annotation.NonNull;
import com.google.android.gms.tasks.Task;
import com.google.common.util.concurrent.ListenableFuture;

/** APIs returning a Task and a ListenableFuture, and a subclass of Task. */
public abstract class Lookup<K> extends Task<K> {
  @NonNull
  public static Task<String> find(String query) {
    return null;
  }

  @NonNull
  public static ListenableFuture<String> later() {
    return null;
  }
}
