/**
 * The host glue of each component, when views are generated.
 *
 * iOS: the `<registration>ComponentView` React Native's Fabric renderer creates. It
 * derives from the shared host LucentComponentView (runtime/cpp/rn), which
 * mounts on the main thread once a commit is final, registers with React
 * Native's component view factory as it loads, provides the component's
 * Fabric descriptor, and gives the host a lucent::views::Mounted over the
 * component's Mount (setups.ts): created at committed mount, handed each
 * later commit and each command (a request answering through the runtime
 * that sent it), and disposed with the mount. Events go through the view's
 * current event emitter, and are dropped once the view holds another mount.
 * A component taking React children tells the host to keep a slot for them
 * (`lucentTakesChildren`), which its mount gets from the host.
 *
 * Android: `<registration>_android.cpp`, the same LucentMounted for the C++
 * host behind the component's Java manager (runtime/cpp/rn/LucentViewsAndroid.h),
 * made by `mount` and listed, with `requestIdOf`, by `lucent_hosts.cpp`.
 */
import { cpp } from "@lucent-lang/codegen";
import { fabricNames } from "../ui/fabric.ts";
import type { Ctx } from "./context.ts";
import type { Setup } from "./setups.ts";

const constRef = (t: cpp.Type) => cpp.reference(cpp.constType(t));
const HOST = cpp.type("lucent::views::HostView");

/** Each component's `views/<registration>ComponentView.mm`, by path under the generated C++. */
export function iosComponentViews(ctx: Ctx, setups: readonly Setup[]): Map<string, string> {
  const files = new Map<string, string>();

  for (const s of setups) {
    const text = ctx.guard(() => componentView(s));

    if (text) files.set(`views/${s.component.registration}ComponentView.mm`, text);
  }

  return files;
}

/**
 * Each component's `views/<registration>_android.cpp`, and
 * `views/lucent_hosts.cpp` listing them (findComponent), by path under the
 * generated C++.
 */
export function androidComponentHosts(ctx: Ctx, setups: readonly Setup[]): Map<string, string> {
  const files = new Map<string, string>();
  const hosted: string[] = [];

  for (const s of setups) {
    const text = ctx.guard(() => componentHost(s));

    if (!text) continue;

    files.set(`views/${s.component.registration}_android.cpp`, text);
    hosted.push(s.component.registration);
  }

  if (hosted.length) files.set("views/lucent_hosts.cpp", hostList(hosted.sort()));

  return files;
}

/** What differs between the platforms' LucentMounted: what view() gives the host. */
const VIEWS: Record<"ios" | "android", (mount: cpp.Expr) => cpp.Member> = {
  ios: (mount) =>
    cpp.method(
      "view",
      cpp.pointer(cpp.type("UIView")),
      [],
      [
        cpp.ret(
          cpp.cast(
            "bridge",
            cpp.pointer(cpp.type("UIView")),
            cpp.call(cpp.dot(cpp.call(cpp.arrow(mount, "view")), "get")),
          ),
        ),
      ],
      { const: true, override: true },
    ),
  android: (mount) =>
    cpp.method(
      "view",
      cpp.type("lucent::NativeRef"),
      [],
      [cpp.ret(cpp.call(cpp.arrow(mount, "view")))],
      {
        const: true,
        override: true,
      },
    ),
};

/**
 * What an iOS SwiftUI component's LucentMounted gives its host: the hosting
 * controller its setup returns, which the host contains, and its view.
 */
const hostedController = (mount: cpp.Expr): cpp.Member[] => {
  const controller = cpp.pointer(cpp.type("UIViewController"));

  return [
    cpp.method(
      "controller",
      controller,
      [],
      [
        cpp.ret(
          cpp.cast(
            "bridge",
            controller,
            cpp.call(cpp.dot(cpp.call(cpp.arrow(mount, "view")), "get")),
          ),
        ),
      ],
      { const: true, override: true },
    ),
    cpp.method(
      "view",
      cpp.pointer(cpp.type("UIView")),
      [],
      [cpp.ret(cpp.dot(cpp.call(cpp.id("controller")), "view"))],
      { const: true, override: true },
    ),
  ];
};

/** The component's `LucentMounted`: its Mount, as `platform`'s host drives it. */
function mountedStruct(s: Setup, platform: keyof typeof VIEWS): cpp.Decl {
  const c = s.component;
  const mount = cpp.id("mount_");
  const requester = cpp.id("requester");
  const current = cpp.call("std::current_exception");

  // Each event, to the emitter of the view's current commit while the view holds this mount.
  const emit = c.events.length
    ? cpp.lambda(
        ["host"],
        [cpp.param(constRef(cpp.type("Event")), "event")],
        [
          cpp.varDecl(
            cpp.auto,
            "emitter",
            cpp.call(
              "std::static_pointer_cast",
              [cpp.call(cpp.dot(cpp.id("host"), "emitter"))],
              [cpp.constType(cpp.type("EventEmitter"))],
            ),
          ),
          cpp.ifStmt(cpp.not(cpp.id("emitter")), [cpp.ret()]),
          ...c.events.map((e): cpp.Stmt => ({
            k: "if",
            bind: { type: cpp.auto, name: "sent" },
            test: cpp.call(
              "std::get_if",
              [cpp.addressOf(cpp.id("event"))],
              [cpp.type(fabricNames.eventStruct(e.slot))],
            ),
            body: [
              cpp.exprStmt(
                cpp.call(cpp.arrow(cpp.id("emitter"), "emit"), [cpp.deref(cpp.id("sent"))]),
              ),
            ],
          })),
        ],
      )
    : cpp.lambda([], [cpp.param(constRef(cpp.type("Event")))], []);

  const reject = (message: cpp.Expr): cpp.Stmt => ({
    k: "if",
    bind: { type: cpp.auto, name: "id" },
    test: cpp.call("requestId", [cpp.id("name"), cpp.id("args")]),
    body: [
      cpp.exprStmt(cpp.call(cpp.dot(requester, "reject"), [cpp.deref(cpp.id("id")), message])),
      cpp.ret(),
    ],
  });

  // Answers go to the runtime that sent the command while the view holds this mount.
  const respond = cpp.call("lucent::views::answerTo", [cpp.id("host_"), requester]);

  // What fails before the command runs (its arguments) rejects a request: it would never settle.
  const command: cpp.Stmt[] = c.commands.length
    ? [
        {
          k: "try",
          body: [
            cpp.exprStmt(
              cpp.call(cpp.arrow(mount, "command"), [
                cpp.call("parseCommand", [cpp.id("name"), cpp.id("args")]),
                respond,
              ]),
            ),
          ],
          catches: [
            {
              body: [reject(cpp.call("lucent::views::thrownMessage", [current])), { k: "throw" }],
            },
          ],
        },
      ]
    : [
        cpp.exprStmt(cpp.cast("static", cpp.voidType, cpp.id("args"))),
        cpp.exprStmt(cpp.cast("static", cpp.voidType, requester)),
        cpp.exprStmt(
          cpp.call("lucent::throwTypeError", [cpp.str(`${c.export} exposes no commands`)]),
        ),
      ];

  return cpp.struct(
    "LucentMounted",
    [
      { k: "access", level: "public" },
      {
        k: "method",
        name: "LucentMounted",
        params: [cpp.param(constRef(cpp.type("Props")), "props"), cpp.param(HOST, "host")],
        initializers: [
          { name: "host_", args: [cpp.id("host")] },
          {
            name: "mount_",
            args: [
              cpp.call("Mount::create", [
                cpp.id("props"),
                emit,
                ...(c.children ? [cpp.call(cpp.dot(cpp.id("host"), "slot"))] : []),
              ]),
            ],
          },
        ],
        body: [],
      },
      {
        k: "comment",
        text: "The mount ends with the host's: its scope's effects, cleanups and subscriptions.",
      },
      {
        k: "method",
        name: "~LucentMounted",
        params: [],
        override: true,
        body: [cpp.exprStmt(cpp.call(cpp.arrow(mount, "dispose")))],
      },
      ...(platform === "ios" && s.toolkit === "swiftui"
        ? hostedController(mount)
        : [VIEWS[platform](mount)]),
      {
        k: "comment",
        text: "A later commit: the mount applies what changed; setup never runs again.",
      },
      cpp.method(
        "update",
        cpp.voidType,
        [
          cpp.param(constRef(cpp.type("facebook::react::Props")), "props"),
          cpp.param(constRef(cpp.type("facebook::react::Props")), "previous"),
        ],
        [
          cpp.exprStmt(
            cpp.call(cpp.arrow(mount, "update"), [
              cpp.call("static_cast", [cpp.id("props")], [constRef(cpp.type("Props"))]),
              cpp.call("static_cast", [cpp.id("previous")], [constRef(cpp.type("Props"))]),
            ]),
          ),
        ],
        { override: true },
      ),
      cpp.method(
        "command",
        cpp.voidType,
        [
          cpp.param(constRef(cpp.type("std::string")), "name"),
          cpp.param(constRef(cpp.type("folly::dynamic")), "args"),
          cpp.param(constRef(cpp.type("lucent::views::Requester")), "requester"),
        ],
        command,
        { override: true },
      ),
      { k: "access", level: "private" },
      cpp.field(HOST, "host_"),
      cpp.field(cpp.type("std::shared_ptr", cpp.type("Mount")), "mount_"),
    ],
    { bases: [{ type: cpp.type("lucent::views::Mounted"), public: true }], final: true },
  );
}

/** The component's `LucentMounted` and its `<registration>ComponentView`. */
function componentView(s: Setup): string {
  const c = s.component;
  const mounted = mountedStruct(s, "ios");
  const cls = `${c.registration}ComponentView`;
  const provider = cpp.type("facebook::react::ComponentDescriptorProvider");

  return cpp.printUnit({
    banner: `Generated by Lucent from ${c.id}. Do not edit.`,
    decls: [
      cpp.include("LucentComponentView.h"),
      cpp.include("LucentViewValues.h"),
      cpp.include(`${c.registration}.h`),
      cpp.include("memory", true),
      cpp.include("utility", true),
      cpp.include("variant", true),
      cpp.namespace("", [
        { k: "usingNamespace", name: `lucent::views::${c.registration}` },
        mounted,
      ]),
      { k: "objcInterface", name: cls, superclass: "LucentComponentView" },
      {
        k: "objcImplementation",
        name: cls,
        methods: [
          {
            static: true,
            ret: cpp.voidType,
            parts: [{ name: "load" }],
            body: [
              cpp.exprStmt(
                cpp.send("LucentComponentView", "lucentRegister:", [cpp.send(cls, "class")]),
              ),
            ],
          },
          {
            static: true,
            ret: provider,
            parts: [{ name: "componentDescriptorProvider" }],
            body: [
              cpp.ret(
                cpp.call(
                  cpp.templateId("facebook::react::concreteComponentDescriptorProvider", [
                    cpp.type(`lucent::views::${c.registration}::ComponentDescriptor`),
                  ]),
                ),
              ),
            ],
          },
          // React Native's view reads _props as the component's own from its first update.
          {
            ret: cpp.type("instancetype"),
            parts: [{ name: "initWithFrame", param: cpp.param(cpp.type("CGRect"), "frame") }],
            body: [
              cpp.exprStmt(
                cpp.assign(cpp.id("self"), cpp.send("super", "initWithFrame:", [cpp.id("frame")])),
              ),
              cpp.ifStmt(cpp.id("self"), [
                cpp.exprStmt(
                  cpp.assign(
                    cpp.id("_props"),
                    cpp.call(
                      `lucent::views::${c.registration}::ShadowNode::defaultSharedProps`,
                      [],
                    ),
                  ),
                ),
              ]),
              cpp.ret(cpp.id("self")),
            ],
          },
          ...(c.children
            ? [
                {
                  static: true,
                  ret: cpp.type("BOOL"),
                  parts: [{ name: "lucentTakesChildren" }],
                  body: [cpp.ret(cpp.id("YES"))],
                },
              ]
            : []),
          {
            ret: cpp.type("std::optional", cpp.type("double")),
            parts: [
              {
                name: "lucentRequestId",
                param: cpp.param(constRef(cpp.type("std::string")), "name"),
              },
              { name: "args", param: cpp.param(constRef(cpp.type("folly::dynamic")), "args") },
            ],
            body: [
              cpp.ret(
                c.commands.length
                  ? cpp.call(`lucent::views::${c.registration}::requestId`, [
                      cpp.id("name"),
                      cpp.id("args"),
                    ])
                  : cpp.id("std::nullopt"),
              ),
            ],
          },
          {
            ret: cpp.type("std::unique_ptr", cpp.type("lucent::views::Mounted")),
            parts: [
              {
                name: "lucentMount",
                param: cpp.param(constRef(cpp.type("facebook::react::Props")), "props"),
              },
              { name: "host", param: cpp.param(HOST, "host") },
            ],
            body: [
              cpp.ret(
                cpp.call(
                  "std::make_unique",
                  [
                    cpp.call(
                      "static_cast",
                      [cpp.id("props")],
                      [constRef(cpp.type(`lucent::views::${c.registration}::Props`))],
                    ),
                    cpp.id("host"),
                  ],
                  [cpp.type("LucentMounted")],
                ),
              ),
            ],
          },
        ],
      },
    ],
  });
}

const MOUNT_PARAMS = [
  cpp.param(constRef(cpp.type("facebook::react::Props")), "props"),
  cpp.param(HOST, "host"),
];
const MOUNTED = cpp.type("std::unique_ptr", cpp.type("lucent::views::Mounted"));
const REQUEST_PARAMS = [
  cpp.param(constRef(cpp.type("std::string")), "name"),
  cpp.param(constRef(cpp.type("folly::dynamic")), "args"),
];
const REQUEST_ID = cpp.type("std::optional", cpp.type("double"));

/** The component's `LucentMounted`, and the `mount` and `requestIdOf` the Android host calls. */
function componentHost(s: Setup): string {
  const c = s.component;

  return cpp.printUnit({
    banner: `Generated by Lucent from ${c.id}. Do not edit.`,
    decls: [
      cpp.include("LucentViewsAndroid.h"),
      cpp.include("LucentViewValues.h"),
      cpp.include(`${c.registration}.h`),
      cpp.include("memory", true),
      cpp.include("utility", true),
      cpp.include("variant", true),
      cpp.namespace("", [
        { k: "usingNamespace", name: `lucent::views::${c.registration}` },
        mountedStruct(s, "android"),
      ]),
      cpp.namespace(`lucent::views::${c.registration}`, [
        cpp.fn("mount", MOUNTED, MOUNT_PARAMS, [
          cpp.ret(
            cpp.call(
              "std::make_unique",
              [
                cpp.call("static_cast", [cpp.id("props")], [constRef(cpp.type("Props"))]),
                cpp.call("std::move", [cpp.id("host")]),
              ],
              [cpp.type("LucentMounted")],
            ),
          ),
        ]),
        cpp.fn(
          "requestIdOf",
          REQUEST_ID,
          REQUEST_PARAMS,
          c.commands.length
            ? [cpp.ret(cpp.call("requestId", [cpp.id("name"), cpp.id("args")]))]
            : [
                cpp.exprStmt(cpp.cast("static", cpp.voidType, cpp.id("name"))),
                cpp.exprStmt(cpp.cast("static", cpp.voidType, cpp.id("args"))),
                cpp.ret(cpp.id("std::nullopt")),
              ],
        ),
      ]),
    ],
  });
}

/** `views/lucent_hosts.cpp`: findComponent over the components with a host (at least one). */
function hostList(registrations: readonly string[]): string {
  const component = cpp.id("component");
  const entry = cpp.type("lucent::views::AndroidComponent");

  return cpp.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      cpp.include("LucentViewsAndroid.h"),
      ...registrations.map((r) =>
        cpp.namespace(`lucent::views::${r}`, [
          cpp.fn("mount", MOUNTED, MOUNT_PARAMS),
          cpp.fn("requestIdOf", REQUEST_ID, REQUEST_PARAMS),
        ]),
      ),
      cpp.namespace("lucent::views", [
        cpp.fn(
          "findComponent",
          cpp.pointer(cpp.constType(entry)),
          [cpp.param(cpp.type("std::string_view"), "name")],
          [
            {
              ...cpp.varDecl(
                cpp.constType(entry),
                "components",
                cpp.initList(
                  registrations.map((r) =>
                    cpp.initList([
                      cpp.str(r),
                      cpp.addressOf(cpp.id(`lucent::views::${r}::mount`)),
                      cpp.addressOf(cpp.id(`lucent::views::${r}::requestIdOf`)),
                    ]),
                  ),
                ),
                { static: true },
              ),
              array: true,
            },
            {
              k: "forRange",
              type: constRef(cpp.auto),
              name: "component",
              range: cpp.id("components"),
              body: [
                cpp.ifStmt(cpp.binary(cpp.id("name"), "==", cpp.dot(component, "name")), [
                  cpp.ret(cpp.addressOf(component)),
                ]),
              ],
            },
            cpp.ret(cpp.nullptr),
          ],
        ),
      ]),
    ],
  });
}
