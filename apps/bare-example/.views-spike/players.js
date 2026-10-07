// The players spike's entry: the example app's name, the players screen.
import { AppRegistry, LogBox } from "react-native";
import app from "../app.json";
import { PlayersSpike } from "./PlayersSpike";

// A development build shows console.error, the spike's log, as toasts.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(app.expo ? "main" : app.name, () => PlayersSpike);
