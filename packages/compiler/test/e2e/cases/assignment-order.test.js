const run = (name) => {
  mod.reset();
  print(name, mod[name](), "|", mod.trail());
};

run("moduleString");
run("moduleNumbers");
run("moduleLogical");
run("moduleThrows");
run("locals");
run("captured");
run("fields");
run("replaced");
run("elements");
run("entries");
run("elementThrows");
run("members");
