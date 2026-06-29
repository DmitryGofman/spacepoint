import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { viteSingleFile } from "vite-plugin-singlefile";

// HTTPS is required for the DeviceOrientation/Motion sensors on iOS.
// `host: true` exposes the dev server on the LAN so a phone can reach it.
//
// SINGLEFILE=1 inlines three.js + all modules into one self-contained
// dist/index.html (used for the static deploy / shareable link).
const singlefile = process.env.SINGLEFILE === "1";

export default defineConfig({
  plugins: [basicSsl(), ...(singlefile ? [viteSingleFile()] : [])],
  server: { host: true },
  base: "./",
});
