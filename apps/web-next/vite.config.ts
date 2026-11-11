import path from "node:path";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { underPortless } from "../../scripts/portless.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, mode }) => ({
  plugins: [
    reactRouter(),
    // The React Compiler, as a Babel pass after React Router's own transform
    // of the route modules. The preset carries the TypeScript and JSX syntax
    // plugins the pass needs; the target matches the installed React, so the
    // memoization hooks come from React itself (react/compiler-runtime).
    babel({ presets: [reactCompilerPreset({ target: "19" })] }),
    tailwindcss(),
  ],
  // Stub mode with PORTLESS=0: a fixed address, the way apps/web pins 5180,
  // so the stub API's CORS allowlist and the browser tests can name it.
  server:
    mode === "stub" && !underPortless()
      ? { host: "127.0.0.1", port: 5181, strictPort: true }
      : undefined,
  // The icons and the homepage's screenshots are the old app's, served from
  // its public directory rather than copied: they are Git LFS files, and two
  // copies of each would be two to keep in step. The directory moves here
  // when the old app goes.
  publicDir: path.resolve(__dirname, "../web/public"),
  resolve: {
    // "@/..." is shadcn/ui's alias convention (components.json). Kept in step
    // with tsconfig.json so the type checker resolves it too.
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
  // The server build goes into the Cloudflare Worker (apps/api/src/routes/
  // next.js imports build/server/index.js), so it is bundled for workerd:
  // Web-standard APIs only, and nothing left for a runtime to resolve from
  // node_modules, because the Worker has none. The same bundle runs under the
  // self-hosted Node server, which has every API the Web-standard surface
  // needs.
  //
  // Only for the build. React Router's dev server runs the app in Node
  // through Vite's module runner, which loads dependencies the way Node
  // does; told to inline them instead, it would try to evaluate React's
  // CommonJS entry as a module and fail on the first `module.exports`.
  ssr:
    command === "build"
      ? {
          target: "webworker",
          noExternal: true,
          resolve: {
            conditions: ["workerd", "worker", "browser", "module", "import"],
          },
        }
      : undefined,
}));
