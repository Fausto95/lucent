/**
 * The views fixture's generated Fabric sources (and the players
 * fixture's, whose props are instances), written out with a file
 * that uses what a platform host uses, for compiling against React
 * Native's headers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fabricSources } from "../../src/ui/fabric.ts";
import { GAUGE, components, instanceComponents } from "./views-fixture.ts";

/**
 * Uses what a platform host uses: the descriptor provider the renderer
 * registers, the props' change set, every event, a command and a result's
 * JavaScript value.
 */
const HOST = `#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <views/lucent_views.h>
#include <views/${GAUGE}.h>

namespace gauge = lucent::views::${GAUGE};

facebook::jsi::Value host(
    const gauge::Props& props,
    const gauge::Props& previous,
    const gauge::EventEmitter& emitter,
    facebook::jsi::Runtime& runtime) {
  auto provider = facebook::react::concreteComponentDescriptorProvider<gauge::ComponentDescriptor>();
  (void)provider;

  if (props.changed(previous).any() && props.handlers.test(0))
    emitter.emit(gauge::Event0{props.values.value.value_or(0), std::nullopt});

  emitter.emit(gauge::Event1{});

  auto command = gauge::parseCommand("sample", folly::dynamic::array(1, folly::dynamic::array("pt")));

  if (auto* sample = std::get_if<gauge::Command1>(&command)) (void)sample->request_;

  lucent::views::MountToken token{1, lucent::views::nextGeneration()};
  (void)token;

  return lucent::views::toJs(runtime, props.values.points);
}
`;

/** Writes the fixture's sources and the host's file: the directory, and the files to compile. */
export function writeFabricSources(): { dir: string; files: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fabric-"));
  const sources = fabricSources([...components(), ...instanceComponents()]);

  for (const [name, text] of [...sources, ["host.cpp", HOST] as const]) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }

  const files = [...sources.keys()].filter((f) => f.endsWith(".cpp"));

  return { dir, files: [...files, "host.cpp"] };
}
