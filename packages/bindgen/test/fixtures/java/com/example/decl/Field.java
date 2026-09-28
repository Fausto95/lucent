package com.example.decl;

/** Narrows Marks's CharSequence to a Java object (EditText.getText's Editable). */
public abstract class Field extends Marks {
  public Field() {}

  @Override
  public abstract Editableish getText();
}
