(async () => {
  print(await mod.settlesOnce());
  print(await mod.completesDuringRegistration());
  print(await mod.namedRegistration());
  print(await mod.registrationThrows());
  print(await mod.rejects());
  print(await mod.aborts());
  const c = new AbortController();
  const waiting = mod.waitsForJavaScript(c.signal);
  setTimeout(() => c.abort(new Error("from js")), 10);
  print(await waiting);
  print(await mod.voidResults());
  print(await mod.cleanupOrder());
  print(await mod.subscriptions());
  print(await mod.subscriptionEnds());
})();
