// The view spike's entry: the spike's screen under the name the example
// app registers ("main" for Expo's registerRootComponent). The runner
// makes the app's own entry import this one for the build.
import { AppRegistry, LogBox } from "react-native";
import app from "../app.json";
import { ViewsSpike } from "./ViewsSpike";

// A development build shows console.error, the spike's log, as toasts.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(app.expo ? "main" : app.name, () => ViewsSpike);
