package com.example.tasks;

/** A generic interface with one method: functions implement it. */
public interface Listener<T> {
  void onDone(Result<T> result);
}
