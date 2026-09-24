/** Homepage samples. The Lucent source and its C++ live in generated/compiler-demo.ts. */
export const appUsage = `import { squaredDistance } from "./src/geo.lucent";

// A synchronous call into the compiled C++.
squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25`;

export const commands = `npm install -D @lucent-lang/lucent
npx lucent init`;

/** How JavaScript calls the clipboard port (the port's source is generated/examples/clipboard.ts). */
export const clipboardUsage = `import { getStringAsync, setStringAsync } from "./src/clipboard.lucent";

await setStringAsync("hello");
await getStringAsync(); // "hello"`;
