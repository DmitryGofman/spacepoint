import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS is required for the DeviceOrientation/Motion sensors on iOS.
// `host: true` exposes the dev server on the LAN so a phone can reach it.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true },
  base: "./",
});
