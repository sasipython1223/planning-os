import { expect, test } from "@playwright/test";

test("W5B-B2.3D real WASM validation gate remains diagnostic-only", async ({ page }) => {
  await page.goto("/");

  await page.waitForFunction(() => {
    const status = document.querySelector(".topbar-status")?.textContent ?? "";
    return status.includes("Worker: Ready");
  });

  const result = await page.evaluate(async () => {
    const w = window as unknown as { __runTemporalWasmValidationGate?: () => Promise<any> };
    const statusText = document.querySelector(".topbar-status")?.textContent?.trim() ?? null;
    const rowCount = document.querySelectorAll("tbody tr").length;

    if (typeof w.__runTemporalWasmValidationGate !== "function") {
      throw new Error("window.__runTemporalWasmValidationGate not available");
    }

    const payload = await w.__runTemporalWasmValidationGate();

    const statusTextAfter = document.querySelector(".topbar-status")?.textContent?.trim() ?? null;
    const rowCountAfter = document.querySelectorAll("tbody tr").length;

    return {
      payload,
      before: { statusText, rowCount },
      after: { statusTextAfter, rowCountAfter },
    };
  });

  expect(result.payload.realWasmValidationPassed).toBe(true);
  expect(result.payload.wasmLoadMode).toBe("real");
  expect(result.payload.scenariosPlanned).toBe(7);
  expect(result.payload.scenariosExecuted).toBe(7);
  expect(result.payload.scenariosPassed).toBe(7);
  expect(result.payload.scenariosFailed).toBe(0);
  expect(result.payload.scenariosBlocked).toBe(0);
  expect(result.payload.sourceProtectionStatus).toBe("ok");
  expect(result.payload.authorityApplied).toBe(false);
  expect(result.payload.temporalExecutionErrors.length).toBe(0);
  expect(result.payload.unexplainedDivergenceTaskIds.length).toBe(0);

  // State safety: no visible table rows or status mutation from diagnostic command
  expect(result.after.rowCountAfter).toBe(result.before.rowCount);
  expect(result.after.statusTextAfter).toBe(result.before.statusText);
});
