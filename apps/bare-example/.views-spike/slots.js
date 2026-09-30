// The slots spike's entry: the example app's name, the slots screen.
import { AppRegistry } from "react-native";
import { name } from "../app.json";
import { SlotsSpike } from "./SlotsSpike";

AppRegistry.registerComponent(name, () => SlotsSpike);
