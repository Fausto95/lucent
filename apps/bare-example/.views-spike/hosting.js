// The hosting spike's entry: the example app's name, the hosting screen.
import { AppRegistry, LogBox } from "react-native";
import app from "../app.json";
import { HostingSpike } from "./HostingSpike";

// A development build shows console.error, the spike's log, as toasts.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(app.expo ? "main" : app.name, () => HostingSpike);
