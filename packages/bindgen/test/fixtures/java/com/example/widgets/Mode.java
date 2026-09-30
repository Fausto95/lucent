package com.example.widgets;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

/** A named constant group: an annotation type holding its constants, as Play services' Priority. */
@Retention(RetentionPolicy.SOURCE)
public @interface Mode {
  int FAST = 1;
  int SLOW = 2;
}
