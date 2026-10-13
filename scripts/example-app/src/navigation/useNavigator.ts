import { useEffect, useState } from "react";
import { BackHandler, Linking } from "react-native";
import { launchArgument } from "./launchArgument";
import { HOME, parentRoute, parseRoute, type Route, type RouteCatalog } from "./routes";

interface Visit {
  route: Route;
  /** New for every navigation, so reopening a screen starts it afresh. */
  key: number;
}

interface Navigator extends Visit {
  open: (route: Route) => void;
  /** Back to the home section the screen belongs to; null on the home screen. */
  back: (() => void) | null;
}

/** Holds on the navigator's back handling: while any is held, back presses go past it. */
let held = 0;

/**
 * Lets back presses go past the navigator until the returned function is
 * called: the Lab's back press probe, which module code must hear after
 * JavaScript declined the press.
 */
export function holdBack(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}

/**
 * The one piece of navigation state: the current route. It starts at the
 * launch argument's route, then follows deep links (the one that opened the
 * app, and any while it runs) and Android's back button.
 */
export function useNavigator(catalog: RouteCatalog): Navigator {
  const [visit, setVisit] = useState<Visit>(() => {
    const requested = launchArgument();

    return { route: (requested === null ? null : parseRoute(requested, catalog)) ?? HOME, key: 0 };
  });

  function open(route: Route) {
    setVisit((current) => ({ route, key: current.key + 1 }));
  }

  useEffect(() => {
    const follow = (url: string | null | undefined) => {
      const route = url ? parseRoute(url, catalog) : null;
      if (route) open(route);
    };

    void Linking.getInitialURL().then(follow);

    const subscription = Linking.addEventListener("url", ({ url }) => follow(url));

    return () => subscription.remove();
  }, [catalog]);

  const parent = parentRoute(visit.route);

  useEffect(() => {
    const up = parentRoute(visit.route);
    if (!up) return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (held > 0) return false;
      open(up);
      return true;
    });

    return () => subscription.remove();
  }, [visit]);

  return { ...visit, open, back: parent ? () => open(parent) : null };
}
