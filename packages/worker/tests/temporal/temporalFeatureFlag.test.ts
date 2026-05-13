import { beforeEach, describe, expect, it } from "vitest";
import {
    _resetTemporalCompilerFlag,
    isTemporalCompilerEnabled,
    setTemporalCompilerEnabled,
} from "../../src/temporal/temporalFeatureFlag.js";

describe("temporalFeatureFlag", () => {
  beforeEach(() => {
    _resetTemporalCompilerFlag();
  });

  it("defaults to disabled", () => {
    expect(isTemporalCompilerEnabled()).toBe(false);
  });

  it("can be enabled", () => {
    setTemporalCompilerEnabled(true);
    expect(isTemporalCompilerEnabled()).toBe(true);
  });

  it("can be disabled after enabling", () => {
    setTemporalCompilerEnabled(true);
    setTemporalCompilerEnabled(false);
    expect(isTemporalCompilerEnabled()).toBe(false);
  });

  it("resets to disabled", () => {
    setTemporalCompilerEnabled(true);
    _resetTemporalCompilerFlag();
    expect(isTemporalCompilerEnabled()).toBe(false);
  });
});
