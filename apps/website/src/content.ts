/** Homepage samples. The Lucent source and its C++ live in generated/compiler-demo.ts. */
export const appUsage = `import { squaredDistance } from "./src/geo.lucent";

// A synchronous call into the compiled C++.
squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25`;

export const commands = `npm install -D @lucent-lang/lucent
npx lucent init`;

/** How JavaScript calls the homepage's clipboard sample (generated/home-clipboard.ts). */
export const clipboardUsage = `import { hasStringAsync } from "./src/clipboard.lucent";

await hasStringAsync(); // true when the clipboard holds text`;
