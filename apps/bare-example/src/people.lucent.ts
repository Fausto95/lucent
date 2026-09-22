import type { int32 } from "@lucent-lang/core/types";

export type Person = {
  name: string;
  age: int32;
  nickname?: string;
  tags: string[];
};

export function birthday(person: Person): Person {
  return { name: person.name, age: person.age + 1, nickname: person.nickname, tags: person.tags };
}

export function describe(person: Person): string {
  const nickname = person.nickname;
  if (nickname === undefined) {
    return `${person.name} (${person.age})`;
  }
  return `${nickname} aka ${person.name} (${person.age})`;
}

export function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  return sum % 256;
}

export function reverse(data: Uint8Array): Uint8Array {
  return data;
}
