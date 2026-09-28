/**
 * A component's public contract from its checked source: props and events
 * from its props object's type, commands from the object it gives
 * `expose`. Each part is plain data (values.ts); what cannot be one is a
 * message naming the component, the member and the path to the problem.
 */
import ts from "typescript";
import type {
  CommandDescription,
  CommandResult,
  EventDelivery,
  EventDescription,
  ViewField,
} from "./contract.ts";
import {
  type Converted,
  maybeUndefined,
  nullable,
  returnsNothing,
  UNDEFINED,
  type ViewTypes,
} from "./values.ts";

/** Names React keeps, and the host's React Native style: what they are, and what to do. */
const RESERVED: Record<string, string> = {
  key: "a name React keeps: rename it",
  ref: "a name React keeps: rename it",
  children:
    "a name React keeps for its children: type it `Children` (lucent:ui) to take React children, or rename it",
  style: "a name the host keeps for React Native styles: rename it",
};

/** The prop React's children come in, when it has lucent:ui's `Children` type. */
const CHILDREN = "children";

const EVENT_NAME = /^on[A-Z]/;

/** The deliveries lucent:ui's marks give (their brand's value): unmarked is discrete. */
const MARKED: readonly EventDelivery[] = ["continuous", "coalesced"];

/** Whether a declaration is the brand lucent:ui's delivery marks give a callback type. */
export type DeliveryMark = (decl: ts.Declaration) => boolean;

/** A problem's message, and the member it is about (its declaration), if any. */
export interface Located {
  readonly message: string;
  readonly node?: ts.Node;
}

export interface Props {
  readonly props: ViewField[];
  readonly events: EventDescription[];
  /** Whether the props take React children, and may be left without. */
  children?: { readonly optional: boolean };
  readonly problems: Located[];
}

/** Whether a type is lucent:ui's `Children`. */
export type IsChildren = (t: ts.Type) => boolean;

/** The names of a props type's callback props: its events. */
export function eventNames(checker: ts.TypeChecker, props: ts.Type | undefined): Set<string> {
  const out = new Set<string>();

  for (const p of props ? checker.getPropertiesOfType(props) : [])
    if (callable(checker, checker.getTypeOfSymbol(p))) out.add(p.getName());

  return out;
}

/** The props, events and children of component `name` whose props object has type `props`. */
export function describeProps(
  checker: ts.TypeChecker,
  types: ViewTypes,
  marked: DeliveryMark,
  name: string,
  props: ts.Type | undefined,
  isChildren: IsChildren,
): Props {
  const out: Props = { props: [], events: [], problems: [] };

  for (const p of props ? checker.getPropertiesOfType(props) : []) {
    const prop = p.getName();
    const type = checker.getTypeOfSymbol(p);
    const reserved = RESERVED[prop];
    const report = located(out.problems, p);
    const optional = !!(p.flags & ts.SymbolFlags.Optional) || maybeUndefined(type);

    if (prop === CHILDREN && isChildren(checker.getNonNullableType(type))) {
      out.children = { optional };
      continue;
    }

    if (reserved) {
      report(`\`${name}\`'s prop \`${prop}\` is ${reserved}`);
      continue;
    }

    const signature = callable(checker, type);

    if (!signature) {
      push(out.props, report, types.field(p, prop), (path, text) => {
        return `\`${name}\`'s prop \`${path}\` is ${text}`;
      });
      continue;
    }

    if (!EVENT_NAME.test(prop)) {
      const suggested = `on${prop[0]!.toUpperCase()}${prop.slice(1)}`;

      report(
        `\`${name}\`'s prop \`${prop}\` is a function: a function prop is an event, named \`on\` and a capital letter (\`${suggested}\`)`,
      );
      continue;
    }

    const result = checker.getReturnTypeOfSignature(signature);

    if (!returnsNothing(result)) {
      report(
        `\`${name}\`'s event \`${prop}\` returns \`${checker.typeToString(result)}\`: JavaScript handles events later, so an event returns nothing; give the view the value as a prop instead`,
      );
      continue;
    }

    const delivery = deliveryOf(checker, type, marked);

    if (!delivery) {
      report(
        `\`${name}\`'s event \`${prop}\` is marked both continuous and coalesced: mark it once (a coalesced event is continuous)`,
      );
      continue;
    }

    const params = parameters(types, signature, report, (path, text) => {
      return `\`${name}\`'s event \`${prop}\` sends \`${path}\`, which is ${text}`;
    });

    if (params)
      out.events.push({
        name: prop,
        slot: out.events.length,
        optional,
        params,
        delivery,
      });
  }

  return out;
}

/** The commands of component `name` from the object it exposes, of type `exposed`. */
export function describeCommands(
  checker: ts.TypeChecker,
  types: ViewTypes,
  name: string,
  exposed: ts.Type,
  problems: Located[],
): CommandDescription[] {
  const out: CommandDescription[] = [];

  for (const p of checker.getPropertiesOfType(exposed)) {
    const command = p.getName();
    const signature = callable(checker, checker.getTypeOfSymbol(p));
    const report = located(problems, p);

    if (!signature) {
      report(
        `\`${name}\`'s command \`${command}\` is not a function: every exposed member is a command`,
      );
      continue;
    }

    const params = parameters(types, signature, report, (path, text) => {
      return `\`${name}\`'s command \`${command}\` takes \`${path}\`, which is ${text}`;
    });
    const result = commandResult(checker, types, checker.getReturnTypeOfSignature(signature));

    if (!("ok" in result)) {
      const { path, text } = result.problem;

      report(`\`${name}\`'s command \`${command}\` answers \`${path}\`, which is ${text}`);
      continue;
    }

    if (params) out.push({ name: command, params, result: result.ok });
  }

  return out;
}

/** A void command enqueues; any other answers a promise of its result (a promise's value). */
function commandResult(
  checker: ts.TypeChecker,
  types: ViewTypes,
  returned: ts.Type,
): Converted<CommandResult> {
  const promised =
    returned.getSymbol()?.getName() === "Promise"
      ? checker.getTypeArguments(returned as ts.TypeReference)[0]
      : undefined;

  if (!promised && returnsNothing(returned)) return { ok: { kind: "enqueue" } };

  const value = promised ?? returned;

  if (returnsNothing(value)) return { ok: { kind: "request" } };

  if (maybeUndefined(value)) return { problem: { path: "result", text: UNDEFINED } };

  const converted = types.value(checker.getNonNullableType(value), "result", nullable(value));

  return "ok" in converted ? { ok: { kind: "request", value: converted.ok } } : converted;
}

/**
 * The delivery a callback type's lucent:ui mark gives it (unmarked:
 * discrete), or undefined when two marks disagree.
 */
function deliveryOf(
  checker: ts.TypeChecker,
  type: ts.Type,
  marked: DeliveryMark,
): EventDelivery | undefined {
  const brand = checker
    .getPropertiesOfType(checker.getNonNullableType(type))
    .find((p) => p.declarations?.some(marked));

  if (!brand) return "discrete";

  const value = checker.getNonNullableType(checker.getTypeOfSymbol(brand));

  return value.isStringLiteral() ? MARKED.find((d) => d === value.value) : undefined;
}

/** The one call signature of a (possibly optional) function type. */
function callable(checker: ts.TypeChecker, type: ts.Type): ts.Signature | undefined {
  const signatures = checker.getNonNullableType(type).getCallSignatures();

  return signatures.length === 1 ? signatures[0] : undefined;
}

/** A signature's parameters as view fields, or undefined after reporting the first problem. */
function parameters(
  types: ViewTypes,
  signature: ts.Signature,
  report: (message: string) => void,
  message: (path: string, text: string) => string,
): ViewField[] | undefined {
  const out: ViewField[] = [];

  return signature.parameters.every((s) => push(out, report, types.param(s), message))
    ? out
    : undefined;
}

/** Adds a converted field, or its problem's message; whether it converted. */
function push(
  into: ViewField[],
  report: (message: string) => void,
  field: Converted<ViewField>,
  message: (path: string, text: string) => string,
): boolean {
  if ("ok" in field) {
    into.push(field.ok);
    return true;
  }

  report(message(field.problem.path, field.problem.text));
  return false;
}

/** Reports problems about the member `symbol` declares. */
function located(problems: Located[], symbol: ts.Symbol): (message: string) => void {
  const node = symbol.valueDeclaration ?? symbol.declarations?.[0];

  return (message) => problems.push(node ? { message, node } : { message });
}
