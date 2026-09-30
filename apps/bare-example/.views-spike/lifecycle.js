// The lifecycle spike's entry: the example app's name, the lifecycle screen.
import { AppRegistry, LogBox } from "react-native";
import app from "../app.json";
import { LifecycleSpike } from "./LifecycleSpike";

// A development build shows console.error, the spike's log, as toasts.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(app.expo ? "main" : app.name, () => LifecycleSpike);
