const Animal = lucentClass(mod.Animal);
const Dog = lucentClass(mod.Dog);
const Puppy = lucentClass(mod.Puppy);
// Animals created by earlier runs stay counted: report this run's.
const animals = mod.counted();
print(mod.zoo());
print(mod.shapes());
const d = new Dog("fido", "mutt");
print(mod.tricks(d), d.tricks.join("+"), d.name, d instanceof Animal, d instanceof Dog, d instanceof Puppy);
print(mod.narrow(d), mod.narrow(new Animal("cat")));
const p = mod.makePuppy();
print(p instanceof Puppy, p instanceof Dog, p instanceof Animal, p.speak(), p.describe(), p.legs);
print(d.describe(), d.learn("jump") === d);
print(mod.counted() - animals);
const Kitten = lucentClass(mod.Kitten);
const Cat = lucentClass(mod.Cat);
const ps = mod.pets();
print(ps.map((p) => `${p.speak()} ${p instanceof Cat} ${p instanceof Kitten}`).join(" / "));
print(mod.greet(ps[1]), ps[1].name, mod.greet(new Kitten("mia")));
