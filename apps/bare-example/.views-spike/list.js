// The list spike's entry: the example app's name, the list screen.
import { AppRegistry, LogBox } from "react-native";
import app from "../app.json";
import { ListSpike } from "./ListSpike";

// A development build shows console.error, the spike's log, as toasts.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(app.expo ? "main" : app.name, () => ListSpike);
