// The sizing spike's entry: the example app's name, the sizing screen.
import { AppRegistry } from "react-native";
import { name } from "../app.json";
import { SizingSpike } from "./SizingSpike";

AppRegistry.registerComponent(name, () => SizingSpike);
