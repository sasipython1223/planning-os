/**
 * WASM loader - initializes cpm-wasm once and exposes calculate_schedule.
 * Handles the dynamic import and initialization lifecycle.
 *
 * cpm-wasm is built with wasm-pack --target web, so the default export
 * (init) must be awaited before any named exports (calculate_schedule) work.
 */

type CpmWasmModule = {
  calculate_schedule: (request: unknown) => unknown;
};

let wasmModule: CpmWasmModule | null = null;

/**
 * Load and initialize the WASM module.
 * Should be called once during worker initialization.
 */
export const loadCpmWasm = async (): Promise<void> => {
  try {
    const module = await import("cpm-wasm");

    // --target web requires explicit init before exports are usable
    if (typeof module.default === "function") {
      await module.default();
    }

    if (typeof module.calculate_schedule !== "function") {
      throw new Error("calculate_schedule not found on WASM module");
    }

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
