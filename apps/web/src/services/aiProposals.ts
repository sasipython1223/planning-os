import type { AIScheduleSnapshot, AITaskSummary, AIWbsSummary } from "./scheduleSnapshot";

export type AIProposalType =
  | "generate-activities-under-wbs"
  | "suggest-missing-fs"
  | "improve-activity-name"
  | "suggest-duration-change"
  | "management-comment";

export type AIProposalConfidence = "low" | "medium" | "high";
export type AIProposalSeverity = "info" | "warning" | "risk";

export type AIProposalTarget = {
  readonly taskId?: string;
  readonly wbsId?: string;
  readonly dependencyId?: string;
  readonly predTaskId?: string;
  readonly succTaskId?: string;
};

export type GenerateActivitiesPayload = {
  readonly parentWbsId: string;
  readonly activities: readonly {
    readonly tempKey: string;
    readonly name: string;
    readonly durationDays?: number;
    readonly rationale?: string;
  }[];
};

export type MissingFsPayload = {
  readonly predTaskId: string;
  readonly succTaskId: string;
  readonly dependencyType: "FS";
  readonly lagDays?: number;
};

export type RenamePayload = {
  readonly taskId: string;
  readonly currentName: string;
  readonly proposedName: string;
};

export type DurationPayload = {
  readonly taskId: string;
  readonly currentDurationDays: number;
  readonly proposedDurationDays: number;
  readonly reason: string;
};

export type ManagementCommentPayload = {
  readonly scope: "project" | "wbs" | "task";
  readonly text: string;
};

export type AIProposalPayload =
  | GenerateActivitiesPayload
  | MissingFsPayload
  | RenamePayload
  | DurationPayload
  | ManagementCommentPayload;

export type AIProposalCard = {
  readonly id: string;
  readonly type: AIProposalType;
  readonly title: string;
  readonly rationale: string;
  readonly confidence?: AIProposalConfidence;
  readonly severity?: AIProposalSeverity;
  readonly target?: AIProposalTarget;
  readonly proposedChange: AIProposalPayload;
  readonly advisoryOnly: true;
};

export type AIProposalDecision = "unreviewed" | "selected" | "rejected";

export type AIProposalContext = {
  readonly selectedTaskId?: string | null;
  readonly selectedWbsId?: string | null;
};

export function buildDeterministicProposals(
  snapshot: AIScheduleSnapshot,
  context: AIProposalContext = {},
): readonly AIProposalCard[] {
  const proposals: AIProposalCard[] = [];
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const depSet = new Set(snapshot.dependencies.map((dep) => `${dep.predId}->${dep.succId}`));

  const selectedWbs = resolveSelectedWbs(snapshot, context);
  if (selectedWbs) {
    proposals.push(buildGenerateActivitiesProposal(selectedWbs));
  }

  proposals.push(...buildMissingFsProposals(snapshot, depSet, taskById));
  proposals.push(...buildRenameProposals(snapshot));
  proposals.push(...buildDurationProposals(snapshot));
  proposals.push(buildManagementComment(snapshot, selectedWbs));

  return proposals;
}

function resolveSelectedWbs(
  snapshot: AIScheduleSnapshot,
  context: AIProposalContext,
): AIWbsSummary | null {
  if (context.selectedWbsId) {
    const selected = snapshot.wbsSummary.find((wbs) => wbs.id === context.selectedWbsId);
    if (selected) return selected;
  }

  if (context.selectedTaskId) {
    const selectedTask = snapshot.tasks.find((task) => task.id === context.selectedTaskId);
    if (selectedTask) {
      if (selectedTask.isSummary) {
        const byId = snapshot.wbsSummary.find((wbs) => wbs.id === selectedTask.id);
        if (byId) return byId;
      }
      const parentSummary = selectedTask.parentId
        ? snapshot.wbsSummary.find((wbs) => wbs.id === selectedTask.parentId)
        : undefined;
      if (parentSummary) return parentSummary;
      const byCode = snapshot.wbsSummary.find((wbs) => wbs.wbsCode === selectedTask.wbsCode);
      if (byCode) return byCode;
    }
  }

  return snapshot.wbsSummary[0] ?? null;
}

function buildGenerateActivitiesProposal(wbs: AIWbsSummary): AIProposalCard {
  const seed = slugify(wbs.name) || "wbs";
  return {
    id: `proposal-generate-${wbs.id}`,
    type: "generate-activities-under-wbs",
    title: `Generate Activities for ${wbs.name}`,
    rationale: "Fill likely execution steps under the selected WBS to improve decomposition and handoff clarity.",
    confidence: "medium",
    severity: "info",
    target: { wbsId: wbs.id },
    proposedChange: {
      parentWbsId: wbs.id,
      activities: [
        {
          tempKey: `${seed}-plan`,
          name: `Plan ${wbs.name}`,
          durationDays: 5,
          rationale: "Front-load planning and work packaging.",
        },
        {
          tempKey: `${seed}-execute`,
          name: `Execute ${wbs.name}`,
          durationDays: 10,
          rationale: "Primary production scope for this WBS area.",
        },
        {
          tempKey: `${seed}-verify`,
          name: `Verify ${wbs.name}`,
          durationDays: 3,
          rationale: "Closeout and acceptance of deliverables.",
        },
      ],
    },
    advisoryOnly: true,
  };
}

function buildMissingFsProposals(
  snapshot: AIScheduleSnapshot,
  depSet: ReadonlySet<string>,
  taskById: ReadonlyMap<string, AITaskSummary>,
): AIProposalCard[] {
  const proposals: AIProposalCard[] = [];
  const ordered = snapshot.tasks
    .filter((task) => !task.isSummary)
    .slice()
    .sort((a, b) => (a.earlyStartMinutes ?? Number.MAX_SAFE_INTEGER) - (b.earlyStartMinutes ?? Number.MAX_SAFE_INTEGER));

  for (const candidate of snapshot.missingLogicCandidates) {
    if (!candidate.hasPredecessor) {
      const succ = taskById.get(candidate.id);
      const pred = findLikelyPredecessor(ordered, succ);
      if (succ && pred && !depSet.has(`${pred.id}->${succ.id}`)) {
        proposals.push({
          id: `proposal-fs-${pred.id}-${succ.id}`,
          type: "suggest-missing-fs",
          title: `Suggest FS link: ${pred.name} -> ${succ.name}`,
          rationale: "Task appears open-ended without a predecessor; adding FS logic may improve sequence integrity.",
          confidence: "medium",
          severity: "warning",
          target: { predTaskId: pred.id, succTaskId: succ.id },
          proposedChange: {
            predTaskId: pred.id,
            succTaskId: succ.id,
            dependencyType: "FS",
            lagDays: 0,
          },
          advisoryOnly: true,
        });
      }
    }

    if (!candidate.hasSuccessor) {
      const pred = taskById.get(candidate.id);
      const succ = findLikelySuccessor(ordered, pred);
      if (pred && succ && !depSet.has(`${pred.id}->${succ.id}`)) {
        proposals.push({
          id: `proposal-fs-${pred.id}-${succ.id}`,
          type: "suggest-missing-fs",
          title: `Suggest FS link: ${pred.name} -> ${succ.name}`,
          rationale: "Task appears open-ended without a successor; adding FS logic may improve downstream continuity.",
          confidence: "medium",
          severity: "warning",
          target: { predTaskId: pred.id, succTaskId: succ.id },
          proposedChange: {
            predTaskId: pred.id,
            succTaskId: succ.id,
            dependencyType: "FS",
            lagDays: 0,
          },
          advisoryOnly: true,
        });
      }
    }

    if (proposals.length >= 3) break;
  }

  return dedupeProposalIds(proposals);
}

function findLikelyPredecessor(
  tasks: readonly AITaskSummary[],
  task: AITaskSummary | undefined,
): AITaskSummary | null {
  if (!task) return null;
  const taskStart = task.earlyStartMinutes;
  const candidates = tasks.filter((row) => row.id !== task.id && row.earlyFinishMinutes !== null);

  if (taskStart !== null) {
    const eligible = candidates.filter((row) => (row.earlyFinishMinutes ?? Number.MAX_SAFE_INTEGER) <= taskStart);
    if (eligible.length > 0) return eligible[eligible.length - 1];
  }

  const index = tasks.findIndex((row) => row.id === task.id);
  if (index > 0) return tasks[index - 1];
  return null;
}

function findLikelySuccessor(
  tasks: readonly AITaskSummary[],
  task: AITaskSummary | undefined,
): AITaskSummary | null {
  if (!task) return null;
  const taskFinish = task.earlyFinishMinutes;
  const candidates = tasks.filter((row) => row.id !== task.id && row.earlyStartMinutes !== null);

  if (taskFinish !== null) {
    const eligible = candidates.filter((row) => (row.earlyStartMinutes ?? Number.MAX_SAFE_INTEGER) >= taskFinish);
    if (eligible.length > 0) return eligible[0];
  }

  const index = tasks.findIndex((row) => row.id === task.id);
  if (index >= 0 && index < tasks.length - 1) return tasks[index + 1];
  return null;
}

function buildRenameProposals(snapshot: AIScheduleSnapshot): AIProposalCard[] {
  const genericNameRegex = /^(task|activity|new task|tbd|untitled|work item)(\s+\d+)?$/i;

  return snapshot.tasks
    .filter((task) => !task.isSummary)
    .filter((task) => genericNameRegex.test(task.name.trim()))
    .slice(0, 3)
    .map((task) => {
      const proposedName = suggestActivityName(task);
      return {
        id: `proposal-rename-${task.id}`,
        type: "improve-activity-name",
        title: `Improve activity name: ${task.name}`,
        rationale: "Generic activity names reduce readability and reporting quality.",
        confidence: "high",
        severity: "info",
        target: { taskId: task.id },
        proposedChange: {
          taskId: task.id,
          currentName: task.name,
          proposedName,
        },
        advisoryOnly: true,
      } satisfies AIProposalCard;
    });
}

function suggestActivityName(task: AITaskSummary): string {
  const code = task.wbsCode.trim() || "X";
  return `Define deliverable for WBS ${code}`;
}

function buildDurationProposals(snapshot: AIScheduleSnapshot): AIProposalCard[] {
  return snapshot.longDurationCandidates.slice(0, 3).map((candidate) => {
    const proposedDurationDays = clamp(Math.round(candidate.durationDays / 2), 8, 15);
    return {
      id: `proposal-duration-${candidate.id}`,
      type: "suggest-duration-change",
      title: `Review long duration: ${candidate.name}`,
      rationale: "Long activities can mask risk and reduce forecast accuracy. Consider decomposition.",
      confidence: "medium",
      severity: "risk",
      target: { taskId: candidate.id },
      proposedChange: {
        taskId: candidate.id,
        currentDurationDays: candidate.durationDays,
        proposedDurationDays,
        reason: "Break down long activities into smaller measurable steps.",
      },
      advisoryOnly: true,
    } satisfies AIProposalCard;
  });
}

function buildManagementComment(
  snapshot: AIScheduleSnapshot,
  selectedWbs: AIWbsSummary | null,
): AIProposalCard {
  const scope = selectedWbs ? "wbs" : "project";
  const focusText = selectedWbs
    ? `Focus WBS: ${selectedWbs.name}. `
    : "Project-wide summary. ";

  const text =
    `${focusText}${snapshot.missingLogicCandidates.length} open-logic candidate(s), ` +
    `${snapshot.longDurationCandidates.length} long-duration candidate(s), ` +
    `${snapshot.constrainedTasks.length} constrained task(s). ` +
    "Use as advisory commentary for status reporting.";

  return {
    id: "proposal-management-comment",
    type: "management-comment",
    title: "Draft management/report comment",
    rationale: "Provides concise status language for meetings and periodic reporting.",
    confidence: "high",
    severity: "info",
    target: selectedWbs ? { wbsId: selectedWbs.id } : undefined,
    proposedChange: {
      scope,
      text,
    },
    advisoryOnly: true,
  };
}

function dedupeProposalIds(proposals: readonly AIProposalCard[]): AIProposalCard[] {
  const seen = new Set<string>();
  const unique: AIProposalCard[] = [];
  for (const proposal of proposals) {
    if (seen.has(proposal.id)) continue;
    seen.add(proposal.id);
    unique.push(proposal);
  }
  return unique;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
