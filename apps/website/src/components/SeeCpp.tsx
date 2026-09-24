import * as stylex from "@stylexjs/stylex";
import { useLoaderData } from "@tanstack/react-router";
import { useState } from "react";
import { loadCpp } from "../docs/loadCpp";
import type { CppFile } from "../docs/types";
import { CodeTabs } from "./CodeTabs";
import { styles } from "./DocsContent.stylex";

/** "See the C++" under a sample: what the compiler writes for it, generated when the site is built. */
export function SeeCpp({ filename }: { filename: string }) {
  const slug = useLoaderData({ strict: false, select: (data) => data?.lookup?.entry.slug });
  const [files, setFiles] = useState<CppFile[] | "loading" | null>(null);
  if (slug === undefined) throw new Error("SeeCpp renders only on a docs page");
  const open = files !== null;
  return (
    <div {...stylex.props(styles.cpp)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) return setFiles(null);
          setFiles("loading");
          void loadCpp(slug, filename).then(setFiles);
        }}
        {...stylex.props(styles.cppToggle)}
      >
        {open ? "▾" : "▸"} See the C++
      </button>
      {Array.isArray(files) && <CodeTabs tabs={files.map((f) => ({ label: f.label, filename: f.filename, code: f.code }))} />}
    </div>
  );
}
