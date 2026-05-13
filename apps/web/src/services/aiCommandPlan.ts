import type { AIProposalCard, AIProposalType } from "./aiProposals";
import type { AIScheduleSnapshot } from "./scheduleSnapshot";

/**
 * AI-4.1 preview-only command kinds.
 *
 * These are descriptive labels for UI preview only.
 * They are not protocol command imports and are never executed.
 */
export type AICommandPreviewKind = "ADD_TASK" | "ADD_DEPENDENCY" | "UPDATE_TASK";

/**
 * Preview classifier for a proposal.
 * - "command": proposal can map to one or more command-plan items.
 * - "advisory-only": proposal intentionally does not produce commands.
 */
export type AICommandPlanCategory = "command" | "advisory-only";

/**
 * Validation severity used by preview warnings/blockers.
 */
export type AIPlanNoticeSeverity = "warning" | "blocker";

/**
 * Normalized notice attached to a plan item.
 */
export type AIPlanNotice = {
  readonly severity: AIPlanNoticeSeverity;
  readonly message: string;
  readonly code?: string;
};

/**
 * Aggregate status for a preview plan item.
 */
export type AIPlanItemStatus = "ready" | "warning" | "blocked";

/**
 * Command-like item shown in preview.
 *
 * The payloadSummary is text-only to avoid accidental runtime coupling to
 * worker/protocol command shapes in AI-4.1.
 */
export type AICommandPlanItem = {
  readonly id: string;
  readonly proposalId: string;
  readonly proposalType: AIProposalType;
  readonly proposalTitle: string;
  readonly category: "command";
  readonly commandKind: AICommandPreviewKind;
  readonly targetLabel: string;
  readonly payloadSummary: string;
  readonly notices: readonly AIPlanNotice[];
  readonly status: AIPlanItemStatus;
};

/**
 * Advisory item shown in preview when no command is generated.
 */
export type AIAdvisoryPlanItem = {
  readonly id: string;
  readonly proposalId: string;
  readonly proposalType: "management-comment";
  readonly proposalTitle: string;
  readonly category: "advisory-only";
  readonly advisoryLabel: "No command generated - report/comment only." | "No command generated — report/comment only.";
  readonly payloadSummary: string;
  readonly notices: readonly AIPlanNotice[];
  readonly status: AIPlanItemStatus;
};

export type AICommandPlanPreviewItem = AICommandPlanItem | AIAdvisoryPlanItem;

/**
 * Summary counts for quick UI badges.
 */
export type AICommandPlanSummary = {
  readonly totalItems: number;
  readonly commandItems: number;
  readonly advisoryItems: number;
  readonly readyItems: number;
  readonly warningItems: number;
  readonly blockedItems: number;
};

/**
 * Full preview model for AI-4.1.
 */
export type AICommandPlanPreview = {
  readonly selectedProposalCount: number;
  readonly generatedAtIso: string;
  readonly items: readonly AICommandPlanPreviewItem[];
  readonly summary: AICommandPlanSummary;
  readonly globalNotices: readonly AIPlanNotice[];
  readonly previewOnlyLabel:
    | "Preview only - no schedule changes will be made."
    | "Preview only — no schedule changes will be made.";
};

/**
 * Inputs required to build a preview plan from selected proposals.
 */
export type AICommandPlanBuildInput = {
  readonly snapshot: AIScheduleSnapshot;
  readonly proposals: readonly AIProposalCard[];
  readonly selectedProposalIds: ReadonlySet<string>;
  readonly nowIso?: string;
};

const DURATION_WARNING =
  "Duration changes affect schedule calculation and require user approval in AI-4.2.";

export function buildCommandPlanPreview(input: AICommandPlanBuildInput): AICommandPlanPreview {
  const selectedProposals = input.proposals.filter((proposal) =>
    input.selectedProposalIds.has(proposal.id),
  );

  const taskById = new Map(input.snapshot.tasks.map((task) => [task.id, task]));
  const wbsById = new Map(input.snapshot.wbsSummary.map((wbs) => [wbs.id, wbs]));
  const depKeySet = new Set(input.snapshot.dependencies.map((dep) => `${dep.predId}->${dep.succId}`));

  const items: AICommandPlanPreviewItem[] = [];

  for (const proposal of selectedProposals) {
    if (proposal.type === "generate-activities-under-wbs") {
      const payload = proposal.proposedChange;
      if (!("parentWbsId" in payload) || !("activities" in payload)) continue;

      for (const activity of payload.activities) {
        const notices: AIPlanNotice[] = [];
        const parentWbs = wbsById.get(payload.parentWbsId);
        if (!parentWbs) {
          notices.push({
            severity: "blocker",
            code: "missing_parent_wbs",
            message: "Target WBS no longer exists.",
          });
        }

        items.push({
          id: `${proposal.id}:${activity.tempKey}`,
          proposalId: proposal.id,
          proposalType: proposal.type,
          proposalTitle: proposal.title,
          category: "command",
          commandKind: "ADD_TASK",
          targetLabel: parentWbs
            ? `Parent WBS: ${parentWbs.name} (${parentWbs.id})`
            : `Parent WBS: ${payload.parentWbsId}`,
          payloadSummary: `name=${activity.name}${activity.durationDays != null ? `, durationDays=${activity.durationDays}` : ""}`,
          notices,
          status: statusFromNotices(notices),
        });
      }
      continue;
    }

    if (proposal.type === "suggest-missing-fs") {
      const payload = proposal.proposedChange;
      if (!("predTaskId" in payload) || !("succTaskId" in payload)) continue;

      const notices: AIPlanNotice[] = [];
      const pred = taskById.get(payload.predTaskId);
      const succ = taskById.get(payload.succTaskId);
      if (!pred || !succ) {
        notices.push({
          severity: "blocker",
          code: "missing_task",
          message: "Predecessor or successor task no longer exists.",
        });
      }
      if (payload.predTaskId === payload.succTaskId) {
        notices.push({
          severity: "blocker",
          code: "self_dependency",
          message: "Self-dependency is invalid.",
        });
      }
      if (depKeySet.has(`${payload.predTaskId}->${payload.succTaskId}`)) {
        notices.push({
          severity: "warning",
          code: "dependency_exists",
          message: "Dependency already exists.",
        });
      }

      items.push({
        id: proposal.id,
        proposalId: proposal.id,
        proposalType: proposal.type,
        proposalTitle: proposal.title,
        category: "command",
        commandKind: "ADD_DEPENDENCY",
        targetLabel: `Pred: ${payload.predTaskId} -> Succ: ${payload.succTaskId}`,
        payloadSummary: `type=${payload.dependencyType}${payload.lagDays != null ? `, lagDays=${payload.lagDays}` : ""}`,
        notices,
        status: statusFromNotices(notices),
      });
      continue;
    }

    if (proposal.type === "improve-activity-name") {
      const payload = proposal.proposedChange;
      if (!("taskId" in payload) || !("proposedName" in payload)) continue;

      const notices: AIPlanNotice[] = [];
      if (!taskById.has(payload.taskId)) {
        notices.push({
          severity: "blocker",
          code: "missing_task",
          message: "Target task no longer exists.",
        });
      }

      items.push({
        id: proposal.id,
        proposalId: proposal.id,
        proposalType: proposal.type,
        proposalTitle: proposal.title,
        category: "command",
        commandKind: "UPDATE_TASK",
        targetLabel: `Task: ${payload.taskId}`,
        payloadSummary: `name: ${payload.currentName} -> ${payload.proposedName}`,
        notices,
        status: statusFromNotices(notices),
      });
      continue;
    }

    if (proposal.type === "suggest-duration-change") {
      const payload = proposal.proposedChange;
      if (!("taskId" in payload) || !("proposedDurationDays" in payload)) continue;

      const notices: AIPlanNotice[] = [
        {
          severity: "warning",
          code: "duration_requires_approval",
          message: DURATION_WARNING,
        },
      ];

      if (!taskById.has(payload.taskId)) {
        notices.push({
          severity: "blocker",
          code: "missing_task",
          message: "Target task no longer exists.",
        });
      }
      if (!Number.isFinite(payload.proposedDurationDays) || payload.proposedDurationDays <= 0) {
        notices.push({
          severity: "blocker",
          code: "invalid_duration",
          message: "Proposed duration is invalid.",
        });
      }

      items.push({
        id: proposal.id,
        proposalId: proposal.id,
        proposalType: proposal.type,
        proposalTitle: proposal.title,
        category: "command",
        commandKind: "UPDATE_TASK",
        targetLabel: `Task: ${payload.taskId}`,
        payloadSummary: `durationDays: ${payload.currentDurationDays} -> ${payload.proposedDurationDays}`,
        notices,
        status: statusFromNotices(notices),
      });
      continue;
    }

    if (proposal.type === "management-comment") {
      const payload = proposal.proposedChange;
      const text = "text" in payload ? payload.text : "";
      items.push({
        id: proposal.id,
        proposalId: proposal.id,
        proposalType: proposal.type,
        proposalTitle: proposal.title,
        category: "advisory-only",
        advisoryLabel: "No command generated — report/comment only.",
        payloadSummary: text,
        notices: [],
        status: "ready",
      });
    }
  }

  const summary = buildSummary(items);

  return {
    selectedProposalCount: selectedProposals.length,
    generatedAtIso: input.nowIso ?? new Date().toISOString(),
    items,
    summary,
    globalNotices: [],
    previewOnlyLabel: "Preview only — no schedule changes will be made.",
  };
}

function statusFromNotices(notices: readonly AIPlanNotice[]): AIPlanItemStatus {
  if (notices.some((notice) => notice.severity === "blocker")) return "blocked";
  if (notices.some((notice) => notice.severity === "warning")) return "warning";
  return "ready";
}

function buildSummary(items: readonly AICommandPlanPreviewItem[]): AICommandPlanSummary {
  return {
    totalItems: items.length,
    commandItems: items.filter((item) => item.category === "command").length,
    advisoryItems: items.filter((item) => item.category === "advisory-only").length,
    readyItems: items.filter((item) => item.status === "ready").length,
    warningItems: items.filter((item) => item.status === "warning").length,
    blockedItems: items.filter((item) => item.status === "blocked").length,
  };
}

