(async () => {
  const { counter, clock } = mods;
  const start = counter.bump();

  // A synchronous call into one actor whose JavaScript callback calls into
  // the other, whose callback calls the first again.
  print(counter.around(() => clock.tick(() => counter.bump() - start)));
  print(counter.around(() => counter.bump() + counter.bump() - 2 * start));

  // Both actors' async work at once.
  const [steps, later] = await Promise.all([counter.steps(3), clock.later(5)]);
  print(steps - 3 * start, later);
  print(
    counter.bump() - start,
    clock.tick(() => 0),
  );
})();
