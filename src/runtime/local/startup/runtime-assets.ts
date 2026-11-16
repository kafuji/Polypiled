// @ts-nocheck
// Legacy dynamic WASM integration; dependency membership is checked by assembly.

import type { RuntimeCoordinator } from "../runtime-coordinator";

export interface RuntimeAssetsDependencies {
  readonly coordinator: Pick<
    RuntimeCoordinator,
    "runtimeSourceUrl"
  >;
}

/** Runtime assets and URL resolution. */
export class RuntimeAssets {

  constructor(private readonly deps: RuntimeAssetsDependencies) {}

  // Startup options written by an older build may name a runtime that no
  // longer exists. Every request runs NetHack 5.0.
  normalizeRuntimeVersion(_value) {
    return "5.0";
  }

  getRuntimeModuleAssetPath() {
    return "nethack-5.js";
  }

  getRuntimeWasmAssetPath() {
    return "nethack-5.wasm";
  }

  readRuntimeBuildTag() {
    const rawValue = import.meta.env.VITE_NH3D_WASM_5_RUNTIME_BUILD_TAG;
    const runtimeBuildTag =
      typeof rawValue === "string" ? rawValue.trim() : "";
    const rawDevSessionTag = import.meta.env.VITE_NH3D_DEV_SESSION_TAG;
    const devSessionTag =
      import.meta.env.DEV && typeof rawDevSessionTag === "string"
        ? rawDevSessionTag.trim()
        : "";
    if (!devSessionTag) {
      return runtimeBuildTag;
    }
    return runtimeBuildTag
      ? `${runtimeBuildTag}.${devSessionTag}`
      : devSessionTag;
  }

  appendRuntimeBuildTagToUrl(rawUrl) {
    const normalizedUrl = String(rawUrl ?? "").trim();
    if (!normalizedUrl) {
      return normalizedUrl;
    }

    const runtimeBuildTag = this.readRuntimeBuildTag();
    if (!runtimeBuildTag || normalizedUrl.startsWith("file:")) {
      return normalizedUrl;
    }

    const referenceUrl =
      typeof globalThis.location?.href === "string" && globalThis.location.href
        ? globalThis.location.href
        : this.deps.coordinator.runtimeSourceUrl;
    try {
      const taggedUrl = new URL(normalizedUrl, referenceUrl);
      taggedUrl.searchParams.set("nh3d_rt", runtimeBuildTag);
      return taggedUrl.href;
    } catch {
      return normalizedUrl;
    }
  }

  async loadRuntimeFactory(version) {
    const importFactoryFromUrl = async (moduleUrl, source) => {
      console.log("Loading NetHack runtime factory", {
        runtimeVersion: version,
        source,
        moduleUrl,
        runtimeBuildTag: this.readRuntimeBuildTag() || null,
      });
      const { default: factory } = await import(/* @vite-ignore */ moduleUrl);
      return factory;
    };

    const moduleUrl = this.resolveWasmAssetUrl(this.getRuntimeModuleAssetPath());
    return importFactoryFromUrl(moduleUrl, "public-runtime");
  }

  resolveWasmAssetUrl(assetPath) {
    const normalizedAsset = String(assetPath || "").replace(/^\/+/, "");
    const baseUrl =
      typeof import.meta !== "undefined" &&
        import.meta.env &&
        typeof import.meta.env.BASE_URL === "string"
        ? import.meta.env.BASE_URL
        : "/";

    // In packaged Electron (file://), Vite worker bundles are emitted into
    // dist/assets while wasm files are copied to dist/. A BASE_URL of "./"
    // would otherwise resolve relative to dist/assets and miss the wasm file.
    const workerLocationHref =
      typeof globalThis !== "undefined" &&
        globalThis.location &&
        typeof globalThis.location.href === "string"
        ? globalThis.location.href
        : "";
    const isFileWorker = workerLocationHref.startsWith("file:");
    if (isFileWorker && (baseUrl === "./" || baseUrl === ".")) {
      try {
        return this.appendRuntimeBuildTagToUrl(
          new URL(`../${normalizedAsset}`, workerLocationHref).toString(),
        );
      } catch {
        // Fall through to default base handling.
      }
    }

    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return this.appendRuntimeBuildTagToUrl(`${normalizedBase}${normalizedAsset}`);
  }
}
