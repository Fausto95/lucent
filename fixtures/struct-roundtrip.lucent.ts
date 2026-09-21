import type { int32 } from "@lucent-lang/types";

export type User = {
  id: string;
  age: int32;
  nickname?: string;
  tags: string[];
};

export function birthday(user: User): User {
  return { id: user.id, age: user.age + 1, nickname: user.nickname, tags: user.tags };
}

export function describe(user: User): string {
  const nickname = user.nickname;
  if (nickname === undefined) {
    return `${user.id} (${user.age})`;
  }
  return `${nickname} aka ${user.id}`;
}
