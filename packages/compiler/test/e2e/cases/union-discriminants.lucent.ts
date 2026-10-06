// A union value from JavaScript whose discriminant matches no member fails
// at the boundary, naming the field and the values it accepts.
type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };

export function shape(s: Circle | Square): string {
  return s.kind === "circle" ? `circle ${s.r}` : `square ${s.s}`;
}
