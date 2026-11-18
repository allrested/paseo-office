import path from "node:path";
import { defineConfig } from "vitest/config";

// React's test APIs require its development build, even in a production shell.
process.env.NODE_ENV = "test";

const modules = path.resolve(import.meta.dirname, "node_modules");

export default defineConfig({
  resolve: {
    // The web build of a module wins, as in the app's bundler: `web-env.web.ts` and the like.
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: "react-native",
        replacement: path.resolve(modules, "react-native-web/dist/index.js"),
      },
    ],
  },
  test: {
    // scripts/*.test.mjs run under node:test (`npm run test:scripts`), not vitest.
    exclude: ["node_modules/**", "vendor/**", "scripts/**"],
  },
});
