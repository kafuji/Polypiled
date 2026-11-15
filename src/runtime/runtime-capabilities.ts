import type { NethackRuntimeVersion } from "./types";

function readDefinedBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return false;
}

// These take the runtime version so callers keep one signature; NetHack 5.0 is
// the only runtime, so the answer depends on the shipped build alone.

export function hasRuntimeCheckpointRecoveryPrimitiveExport(
  runtimeVersion: NethackRuntimeVersion,
): boolean {
  return readDefinedBoolean(
    import.meta.env.VITE_NH3D_WASM_5_HAS_RECOVER_SAVEFILE,
  );
}

export function supportsRuntimeCheckpointRecovery(
  runtimeVersion: NethackRuntimeVersion,
): boolean {
  return readDefinedBoolean(
    import.meta.env.VITE_NH3D_WASM_5_HAS_CHECKPOINT_RESUME_BRIDGE,
  );
}

export function supportsRuntimeTopScores(
  runtimeVersion: NethackRuntimeVersion,
): boolean {
  return true;
}
