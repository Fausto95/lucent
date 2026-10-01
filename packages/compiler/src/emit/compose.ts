/**
 * Compose bodies (Android): the JSX a component returns, and the
 * composition statements of its setup (ui/composition.ts). The body's
 * Kotlin (ui/compose.ts) joins the program's Kotlin, and the setup makes
 * the state holder it reads (runtime lucent/platform/compose.h), which
 * toolkit.ts feeds: an effect per value slot calls the holder's `set`, and
 * each action slot is given to it as a Kotlin function object that enters
 * the main context.
 *
 * The returned JSX's value is the ComposeView; the mount's scope disposes
 * its composition when the mount ends.
 */
import { cpp } from "@lucent-lang/codegen";
import { composeContent } from "../ui/compose.ts";
import { checkComposition, compositionStatements } from "../ui/composition.ts";
import { bodyFail, Crossings, isJsx, skipParentheses } from "../ui/toolkit-body.ts";
import { bodySetup, site } from "./setups.ts";
import type { ToolkitEmitter } from "./toolkit.ts";

export const composeEmitter: ToolkitEmitter = {
  lifted(checker, setup) {
    checkComposition(checker, setup.fn);

    return compositionStatements(checker, setup.fn);
  },

  body(em, setup, body, call) {
    const jsx = skipParentheses(body);

    if (!isJsx(jsx))
      bodyFail(
        body,
        "a Compose body is JSX: its root element takes its modifier as a prop (`modifier={…}`)",
      );

    const owner = bodySetup(setup);
    const lifted = compositionStatements(em.checker, setup.fn);
    const crossings = new Crossings(em.checker, "compose", owner, jsx, lifted);
    const content = composeContent(em.checker, owner, jsx, lifted, crossings);
    const holder = em.ctx.fresh("content");
    const where = cpp.str(site(call));

    em.ctx.nativeUnit(em.opts.module).include("lucent/platform/compose.h");
    em.ctx.javaClasses.add(content.stateClass);
    em.ctx.javaClasses.add(content.hostClass);
    em.emit(
      cpp.varDecl(
        cpp.auto,
        holder,
        cpp.call("lucent::compose::Holder::create", [
          cpp.str(content.stateClass),
          cpp.str(content.hostClass),
        ]),
      ),
    );

    return {
      crossings,
      file: () => ({ name: content.file, text: content.kotlin }),
      host: {
        captures: [holder],
        runtime: "lucent::compose",
        encoded: cpp.type("jobject"),
        // Encoded values are local references: the holder makes them in its own frame.
        set: (slot, value, as) =>
          cpp.call(cpp.dot(cpp.id(holder), "set"), [
            cpp.num(slot.index),
            as === "scalar"
              ? value
              : cpp.lambda(["&"], [], [cpp.ret(value)], { ret: cpp.type("jobject") }),
          ]),
        setList: (list, records) =>
          cpp.call(cpp.dot(cpp.id(holder), "setList"), [
            cpp.num(list.index),
            cpp.lambda(["&"], [], [cpp.ret(records)], { ret: cpp.type("jobject") }),
          ]),
        act: (slot, f) =>
          cpp.exprStmt(
            cpp.call(cpp.dot(cpp.id(holder), "setAction"), [cpp.num(slot.index), f, where]),
          ),
        dispose: [cpp.exprStmt(cpp.call(cpp.dot(cpp.id(holder), "dispose")))],
        value: cpp.call(cpp.dot(cpp.id(holder), "content")),
      },
    };
  },
};
