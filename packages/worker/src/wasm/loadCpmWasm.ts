/**
 * WASM loader - initializes cpm-wasm once and exposes calculate_schedule.
 * Handles the dynamic import and initialization lifecycle.
 */

type CpmWasmModule = {
  calculate_schedule: (request: unknown) => unknown;
};

let wasmModule: CpmWasmModule | null = null;

/**
 * Load and initialize the WASM module.
 * Should be called once during worker initialization.
 * With --target bundler, WASM auto-initializes on import.
 */
export const loadCpmWasm = async (): Promise<void> => {
  try {
    const module = await import("cpm-wasm");
    wasmModule = module as CpmWasmModule;
  } catch (error) {
    throw new Error(`Failed to load WASM module: ${error}`);
  }
};

/**
 * Get the initialized WASM module.
 * Throws if WASM hasn't been loaded yet.
 */
export const getCpmWasm = (): CpmWasmModule => {
  if (!wasmModule) {
    throw new Error("WASM module not loaded. Call loadCpmWasm() first.");
  }
  return wasmModule;
};

/**
 * Check if WASM is loaded.
 */
export const isWasmLoaded = (): boolean => {
  return wasmModule !== null;
};
