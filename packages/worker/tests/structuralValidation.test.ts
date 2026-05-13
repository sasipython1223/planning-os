import type { Task, WorkMinutes } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import * as State from "../src/state.js";
import * as StructuralValidation from "../src/structuralValidation.js";
import { d } from "./helpers.js";

/** Helper to create a minimal task. */
const mkTask = (id: string, name: string, opts?: { parentId?: string; siblingOrder?: string; constraintType?: string }): Task => ({
  id,
  name,
  durationWorkMinutes: d(5),
  siblingOrder: opts?.siblingOrder ?? "V",
  parentId: opts?.parentId,
  constraintType: (opts?.constraintType as Task["constraintType"]) ?? "ASAP",
});

beforeEach(() => {
  State.clearState();
});

// ── validateIndent ───────────────────────────────────────────────────

describe("validateIndent", () => {
  it("rejects when task not found", () => {
    expect(StructuralValidation.validateIndent("nope")).toContain("not found");
  });

  it("rejects when no previous sibling", () => {
    State.addTask(mkTask("a", "A"));
    expect(StructuralValidation.validateIndent("a")).toContain("no previous sibling");
  });

  it("accepts valid indent", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    expect(StructuralValidation.validateIndent("b")).toBeNull();
  });

  it("rejects indent when new parent has dependencies", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    State.addTask(mkTask("c", "C", { siblingOrder: "s" }));
    State.addDependency({ id: "d1", predId: "a", succId: "c", type: "FS", lagWorkMinutes: 0 as WorkMinutes });
    // "b" tries to indent under "a", but "a" has a dependency → reject
    const err = StructuralValidation.validateIndent("b");
    expect(err).toContain("summary");
    expect(err).toContain("dependencies");
  });

  it("rejects indent when new parent has non-ASAP constraint", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V", constraintType: "SNET" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    const err = StructuralValidation.validateIndent("b");
    expect(err).toContain("summary");
    expect(err).toContain("constraint");
  });

  it("rejects indent when new parent has resource assignments", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "asgn1", taskId: "a", resourceId: "r1", unitsPerDay: 1 });
    const err = StructuralValidation.validateIndent("b");
    expect(err).toContain("summary");
    expect(err).toContain("assignments");
  });

  it("allows indent when new parent already has children (already summary)", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("child", "Child", { siblingOrder: "V", parentId: "a" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    // "a" already has a child — it's already a summary, so no new violation
    State.addDependency({ id: "d1", predId: "a", succId: "b", type: "FS", lagWorkMinutes: 0 as WorkMinutes });
    // This would normally block, but since "a" already is summary, the check skips
    expect(StructuralValidation.validateIndent("b")).toBeNull();
  });
});

// ── validateOutdent ──────────────────────────────────────────────────

describe("validateOutdent", () => {
  it("rejects when task not found", () => {
    expect(StructuralValidation.validateOutdent("nope")).toContain("not found");
  });

  it("rejects when task is at root level", () => {
    State.addTask(mkTask("a", "A"));
    expect(StructuralValidation.validateOutdent("a")).toContain("root level");
  });

  it("accepts valid outdent", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "V", parentId: "a" }));
    expect(StructuralValidation.validateOutdent("b")).toBeNull();
  });
});

// ── validateMove ─────────────────────────────────────────────────────

describe("validateMove", () => {
  it("rejects when task not found", () => {
    expect(StructuralValidation.validateMove("nope", undefined)).toContain("not found");
  });

  it("rejects move under self", () => {
    State.addTask(mkTask("a", "A"));
    expect(StructuralValidation.validateMove("a", "a")).toContain("under itself");
  });

  it("rejects move under own descendant", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "V", parentId: "a" }));
    State.computeHierarchy();
    expect(StructuralValidation.validateMove("a", "b")).toContain("own descendant");
  });

  it("rejects move to non-existent parent", () => {
    State.addTask(mkTask("a", "A"));
    expect(StructuralValidation.validateMove("a", "ghost")).toContain("not found");
  });

  it("rejects move when new parent has dependencies (would become summary)", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    State.addTask(mkTask("c", "C", { siblingOrder: "s" }));
    State.addDependency({ id: "d1", predId: "b", succId: "c", type: "FS", lagWorkMinutes: 0 as WorkMinutes });
    // Move "a" under "b" — but "b" has deps
    const err = StructuralValidation.validateMove("a", "b");
    expect(err).toContain("summary");
    expect(err).toContain("dependencies");
  });

  it("accepts valid move to root", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "V", parentId: "a" }));
    expect(StructuralValidation.validateMove("b", null)).toBeNull();
  });

  it("accepts valid move to new parent", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    expect(StructuralValidation.validateMove("b", "a")).toBeNull();
  });

  it("rejects move when afterTaskId not among target siblings", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    State.addTask(mkTask("c", "C", { siblingOrder: "s" }));
    const err = StructuralValidation.validateMove("c", "a", "b");
    expect(err).toContain("not found among target siblings");
  });
});

// ── validateReorder ──────────────────────────────────────────────────

describe("validateReorder", () => {
  it("rejects when task not found", () => {
    expect(StructuralValidation.validateReorder("nope")).toContain("not found");
  });

  it("accepts valid reorder (place first)", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    expect(StructuralValidation.validateReorder("b")).toBeNull();
  });

  it("accepts valid reorder (after sibling)", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    State.addTask(mkTask("c", "C", { siblingOrder: "s" }));
    expect(StructuralValidation.validateReorder("c", "a")).toBeNull();
  });

  it("rejects reorder when afterTaskId not found among siblings", () => {
    State.addTask(mkTask("a", "A", { siblingOrder: "V" }));
    State.addTask(mkTask("b", "B", { siblingOrder: "k" }));
    State.addTask(mkTask("child", "Child", { siblingOrder: "V", parentId: "a" }));
    // "child" is not a sibling of "b" (different parent)
    const err = StructuralValidation.validateReorder("b", "child");
    expect(err).toContain("not found among siblings");
  });
});
