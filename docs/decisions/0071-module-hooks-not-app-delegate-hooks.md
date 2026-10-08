# 0071. Module hooks, not app-delegate hooks

- **Date:** 2026-10-08
- **Status:** accepted

A module's top-level code is its create hook, run for each JavaScript runtime, and `onDestroy` from `lucent:core` its destroy hook: it runs when the host of the state it was registered for is torn down, holding the Lucent lock, before a reload initializes the modules again, so it reads the state that is ending. Deep links and push tokens were left out: Lucent replaces no app or scene delegate, a push token reaches nothing else, and iOS URLs would come from React Native's `RCTOpenURLNotification`, which no host here can post; Android's arrive as new intents, which `onActivityEvent` already reports. _Changed:_ [TA37](../tasks.md#ta37).
