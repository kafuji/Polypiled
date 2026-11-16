import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.kafuji.polypiled",
  appName: "Polypiled",
  webDir: "dist",
  bundledWebRuntime: false,
  appVersion: "0.9.1",
  plugins: {
    SystemBars: {
      insetsHandling: "css",
    },
  },
};

export default config;
