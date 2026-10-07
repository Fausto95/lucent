// The players spike's screen: two players JavaScript makes, each shown by
// a PlayerView taking its id, as Expo's VideoView takes its player's. Two
// seconds in, JavaScript renames the first through main(): its view shows
// the new title with no render. The screen logs (LUCENT_VIEWS lines) what
// a rest parameter and ArrayBuffers give through the app's JSI.
import { useEffect } from "react";
import { SafeAreaView, Text, View } from "react-native";
// A relative import is typed as the Lucent component: its React export, as lucent:views/<module> types it.
import * as players from "./players.lucent";

const { Player, PlayerView, joined, checksum, filled } = players as unknown as {
  Player: new (title: string) => { id: number; rename(title: string): void };
  PlayerView: (props: { player: number; style?: object }) => React.ReactNode;
  joined: (...words: string[]) => string;
  checksum: (buffer: ArrayBuffer) => number;
  filled: (n: number, value: number) => ArrayBuffer;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

const first = new Player("first player");
const second = new Player("second player");

export function PlayersSpike() {
  useEffect(() => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const made = filled(3, 7);

    log(`players rest ${joined()}|${joined("a", "b", "c")}`);
    log(
      `players buffer ${checksum(bytes.buffer)} ${made instanceof ArrayBuffer} ${made.byteLength}`,
    );

    const timer = setTimeout(() => {
      first.rename("renamed through main()");
      log("players renamed");
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 32 }}>
        <Text>{`players ${first.id} and ${second.id}`}</Text>
        <PlayerView
          player={first.id}
          style={{ width: 280, height: 48, backgroundColor: "#e8f0fe" }}
        />
        <PlayerView
          player={second.id}
          style={{ width: 280, height: 48, backgroundColor: "#fde8e8" }}
        />
      </View>
    </SafeAreaView>
  );
}
