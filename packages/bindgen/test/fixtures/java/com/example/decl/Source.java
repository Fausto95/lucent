package com.example.decl;

/** Object results (Adapter.getItem, ExpandableListAdapter.getChild). */
public interface Source {
  Object item(int position);

  Object child();

  Object label();
}
