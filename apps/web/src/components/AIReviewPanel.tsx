/**
 * AIReviewPanel — AI-2
 *
 * Advisory-only AI panel backed by a server-side proxy.
 * The panel never receives worker references and never dispatches commands.
 * AI output stays in component-local state only.
 */

import { useState } from "react";
import {
    AIServiceError,
    runAiFeature,
} from "../services/aiClient";
import {
    buildCommandPlanPreview,
    type AICommandPlanPreview,
    type AICommandPlanPreviewItem,
} from "../services/aiCommandPlan";
import {
    buildMockAiResponse,
    type AIFeature,
} from "../services/aiPrompts";
import {
    buildDeterministicProposals,
    type AIProposalCard,
    type AIProposalDecision,
    type RenamePayload,
} from "../services/aiProposals";
import type { AIScheduleSnapshot } from "../services/scheduleSnapshot";
import { AICommandPlanPreview as AICommandPlanPreviewView } from "./AICommandPlanPreview";
import { AIProposalCards } from "./AIProposalCards";

// ─── Sub-tab types ────────────────────────────────────────────────────────────

type AISubTab = "health" | "summary" | "ask" | "suggestions" | "proposals";

const SUB_TABS: { key: AISubTab; label: string }[] = [
  { key: "health", label: "Health Review" },
  { key: "summary", label: "Mgmt Summary" },
  { key: "ask", label: "Ask the Schedule" },
  { key: "suggestions", label: "Suggestions" },
  { key: "proposals", label: "Proposals" },
];

function featureFromSubTab(subTab: AISubTab): AIFeature {
  switch (subTab) {
    case "health":
      return "health-review";
    case "summary":
      return "management-summary";
    case "ask":
      return "ask-schedule";
    case "suggestions":
      return "suggestions";
    case "proposals":
      return "suggestions";
  }
}

function formatAiError(error: unknown): string {
  if (error instanceof AIServiceError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "AI request failed.";
}

// ─── Simple Markdown renderer ─────────────────────────────────────────────────
// Renders a subset of Markdown (bold, headings, bullet lists) without a library.

function renderMarkdownLine(line: string, key: number): React.ReactNode {
  // Heading levels
  const h2 = line.match(/^## (.+)/);
  if (h2) return <h2 key={key} style={{ margin: "12px 0 4px", fontSize: "0.95em", fontWeight: 700 }}>{h2[1]}</h2>;
  const h3 = line.match(/^### (.+)/);
  if (h3) return <h3 key={key} style={{ margin: "8px 0 2px", fontSize: "0.85em", fontWeight: 700, color: "var(--color-text-secondary, #555)" }}>{h3[1]}</h3>;

  // HR
  if (line === "---") return <hr key={key} style={{ margin: "8px 0", border: "none", borderTop: "1px solid var(--border-default, #ddd)" }} />;

  // Empty line → spacer
  if (line.trim() === "") return <div key={key} style={{ height: 4 }} />;

  // Bullet
  const bullet = line.match(/^- (.+)/);
  if (bullet) {
    return (
      <div key={key} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 2 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>•</span>
        <span style={{ flex: 1 }}>{inlineBold(bullet[1])}</span>
      </div>
    );
  }

  // Italic line (starts with _)
  const italic = line.match(/^_(.+)_$/);
  if (italic) return <p key={key} style={{ margin: "2px 0", fontStyle: "italic", color: "var(--color-text-secondary, #777)", fontSize: "0.82em" }}>{italic[1]}</p>;

  // Normal paragraph
  return <p key={key} style={{ margin: "2px 0" }}>{inlineBold(line)}</p>;
}

function inlineBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 0 ? part : <strong key={i}>{part}</strong>,
      )}
    </>
  );
}

function MarkdownView({ text }: { text: string }) {
  return (
    <div style={{ fontSize: "0.82em", lineHeight: 1.5, fontFamily: "Arial, sans-serif" }}>
      {text.split("\n").map((line, i) => renderMarkdownLine(line, i))}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AIReviewPanelProps {
  /** Pre-built read-only snapshot — must NOT include worker refs or command types. */
  snapshot: AIScheduleSnapshot | null;
  onApplyRenameProposal?: (input: {
    proposalId: string;
    taskId: string;
    currentName: string;
    proposedName: string;
  }) => void;
  renameApplyByProposalId?: Readonly<
    Record<
      string,
      {
        status: "requested" | "applied" | "failed";
        message?: string;
      }
    >
  >;
}

export function AIReviewPanel({ snapshot, onApplyRenameProposal, renameApplyByProposalId = {} }: AIReviewPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<AISubTab>("health");
  const [result, setResult] = useState<string | null>(null);
  const [proposals, setProposals] = useState<readonly AIProposalCard[]>([]);
  const [proposalDecisions, setProposalDecisions] = useState<Record<string, AIProposalDecision>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [responseMode, setResponseMode] = useState<"live" | "mock" | null>(null);

  const selectedProposalIds = new Set(
    Object.entries(proposalDecisions)
      .filter(([, decision]) => decision === "selected")
      .map(([id]) => id),
  );

  const commandPlanPreview: AICommandPlanPreview | null =
    snapshot && selectedProposalIds.size > 0
      ? buildCommandPlanPreview({
          snapshot,
          proposals,
          selectedProposalIds,
        })
      : null;

  const proposalsById = new Map(proposals.map((proposal) => [proposal.id, proposal]));

  function getRenamePayload(proposalId: string): RenamePayload | null {
    const proposal = proposalsById.get(proposalId);
    if (!proposal || proposal.type !== "improve-activity-name") return null;
    const payload = proposal.proposedChange;
    if (!("taskId" in payload) || !("currentName" in payload) || !("proposedName" in payload)) {
      return null;
    }
    return payload;
  }

  function getReviewApplyDecision(item: AICommandPlanPreviewItem): {
    enabled: boolean;
    reason?: string;
    payload?: RenamePayload;
  } {
    if (!onApplyRenameProposal) {
      return { enabled: false, reason: "Rename apply is unavailable." };
    }
    if (item.category !== "command") {
      return { enabled: false, reason: "Advisory-only items cannot be applied." };
    }
    if (item.commandKind !== "UPDATE_TASK" || item.proposalType !== "improve-activity-name") {
      return { enabled: false, reason: "Only rename proposals can be applied in AI-4.2B." };
    }
    if (item.notices.some((notice) => notice.severity === "blocker") || item.status === "blocked") {
      return { enabled: false, reason: "Resolve blockers before apply." };
    }

    const payload = getRenamePayload(item.proposalId);
    if (!payload) {
      return { enabled: false, reason: "Rename payload is unavailable." };
    }

    const proposedName = payload.proposedName.trim();
    if (proposedName.length === 0) {
      return { enabled: false, reason: "Proposed name must be non-empty." };
    }
    if (!snapshot) {
      return { enabled: false, reason: "Snapshot is unavailable." };
    }

    const task = snapshot.tasks.find((candidate) => candidate.id === payload.taskId);
    if (!task) {
      return { enabled: false, reason: "Target task no longer exists." };
    }
    if (task.name.trim() === proposedName) {
      return { enabled: false, reason: "Task name already matches proposed rename." };
    }

    const applyState = renameApplyByProposalId[item.proposalId];
    if (applyState?.status === "requested") {
      return { enabled: false, reason: "Apply request is in progress." };
    }
    if (applyState?.status === "applied") {
      return { enabled: false, reason: "Rename already applied." };
    }

    return { enabled: true, payload };
  }

  function handleReviewApply(item: AICommandPlanPreviewItem) {
    const decision = getReviewApplyDecision(item);
    if (!decision.enabled || !decision.payload || !onApplyRenameProposal) return;

    const payload = decision.payload;
    const proposedName = payload.proposedName.trim();
    const confirmed = window.confirm(
      `Apply rename?\n\nFrom: ${payload.currentName}\nTo: ${proposedName}`,
    );
    if (!confirmed) return;

    onApplyRenameProposal({
      proposalId: item.proposalId,
      taskId: payload.taskId,
      currentName: payload.currentName,
      proposedName,
    });
  }

  async function handleRun() {
    if (!snapshot) return;
    setIsRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      if (activeSubTab === "proposals") {
        const nextProposals = buildDeterministicProposals(snapshot);
        setProposals(nextProposals);
        setResponseMode("mock");
        return;
      }

      const feature = featureFromSubTab(activeSubTab);
      if (feature === "suggestions") {
        setResult(buildMockAiResponse(feature, snapshot));
        setResponseMode("mock");
        return;
      }

      const response = await runAiFeature({
        feature,
        snapshot,
        question: activeSubTab === "ask" ? askQuestion : undefined,
      });
      setResult(response.content);
      setResponseMode(response.mode);
    } catch (error) {
      setErrorMessage(formatAiError(error));
      setResponseMode(null);
    } finally {
      setIsRunning(false);
    }
  }

  function handleUseMockResponse() {
    if (!snapshot) return;
    if (activeSubTab === "proposals") {
      setProposals(buildDeterministicProposals(snapshot));
      setErrorMessage(null);
      setResponseMode("mock");
      return;
    }
    const feature = featureFromSubTab(activeSubTab);
    setResult(buildMockAiResponse(feature, snapshot, askQuestion));
    setErrorMessage(null);
    setResponseMode("mock");
  }

  function handleSubTabChange(key: AISubTab) {
    setActiveSubTab(key);
    setResult(null);
    setErrorMessage(null);
    setResponseMode(null);
  }

  function setProposalDecision(id: string, decision: AIProposalDecision) {
    setProposalDecisions((prev) => ({ ...prev, [id]: decision }));
  }

  const canRun = snapshot !== null && snapshot.taskCount > 0 && !isRunning;
  const askCanRun = canRun && activeSubTab === "ask" && askQuestion.trim().length > 0;
  const runDisabled = activeSubTab === "ask" ? !askCanRun : !canRun;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "Arial, sans-serif", fontSize: "0.82em" }}>
      {/* Sub-tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--border-default, #ddd)",
          background: "var(--bg-secondary, #f5f5f5)",
          paddingLeft: 8,
          flexShrink: 0,
          height: 28,
          gap: 0,
        }}
      >
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleSubTabChange(t.key)}
            style={{
              padding: "4px 10px",
              background: activeSubTab === t.key ? "var(--bg-primary, #fff)" : "transparent",
              border: "none",
              borderBottom: activeSubTab === t.key ? "2px solid var(--accent, #1e88e5)" : "2px solid transparent",
              fontWeight: activeSubTab === t.key ? 600 : 400,
              cursor: "pointer",
              fontSize: "0.85em",
              fontFamily: "inherit",
              borderRadius: 0,
              color: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: "0.75em",
            color: "var(--color-text-secondary, #888)",
            paddingRight: 8,
            fontStyle: "italic",
          }}
        >
          Advisory only - {responseMode === "live" ? "AI-2 (proxy)" : responseMode === "mock" ? "mock fallback" : "AI-2"}
        </span>
      </div>

      {/* Ask input row — shown only on Ask sub-tab */}
      {activeSubTab === "ask" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderBottom: "1px solid var(--border-default, #ddd)",
            background: "var(--bg-surface, #fafafa)",
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={askQuestion}
            onChange={(e) => setAskQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !runDisabled) {
                void handleRun();
              }
            }}
            placeholder="Ask a question about the schedule…"
            style={{
              flex: 1,
              padding: "3px 6px",
              fontSize: "0.85em",
              border: "1px solid var(--border-default, #ccc)",
              borderRadius: 3,
              fontFamily: "inherit",
              background: "var(--bg-primary, #fff)",
              color: "inherit",
            }}
          />
          <button
            onClick={() => {
              void handleRun();
            }}
            disabled={runDisabled}
            style={{
              padding: "3px 10px",
              fontSize: "0.82em",
              cursor: runDisabled ? "default" : "pointer",
              opacity: runDisabled ? 0.5 : 1,
              background: "var(--accent, #1e88e5)",
              color: "#fff",
              border: "none",
              borderRadius: 3,
              fontFamily: "inherit",
            }}
          >
            Ask
          </button>
        </div>
      )}

      {/* Run button row — shown for non-Ask sub-tabs */}
      {activeSubTab !== "ask" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            borderBottom: "1px solid var(--border-default, #ddd)",
            background: "var(--bg-surface, #fafafa)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              void handleRun();
            }}
            disabled={runDisabled}
            style={{
              padding: "3px 12px",
              fontSize: "0.82em",
              cursor: runDisabled ? "default" : "pointer",
              opacity: runDisabled ? 0.5 : 1,
              background: "var(--accent, #1e88e5)",
              color: "#fff",
              border: "none",
              borderRadius: 3,
              fontFamily: "inherit",
            }}
          >
            {activeSubTab === "health" && "Run Health Review"}
            {activeSubTab === "summary" && "Generate Summary"}
            {activeSubTab === "suggestions" && "Get Suggestions"}
            {activeSubTab === "proposals" && "Generate Proposals"}
          </button>
          {!snapshot || snapshot.taskCount === 0 ? (
            <span style={{ fontSize: "0.8em", color: "var(--color-text-secondary, #888)", fontStyle: "italic" }}>
              No schedule data — add tasks and compute schedule first.
            </span>
          ) : null}
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderBottom: "1px solid var(--border-default, #ddd)",
            background: "#fff5f5",
            color: "#8a1c1c",
            fontSize: "0.8em",
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1 }}>{errorMessage}</span>
          {snapshot && (
            <button
              onClick={handleUseMockResponse}
              style={{
                padding: "3px 8px",
                border: "1px solid #d7a1a1",
                background: "#fff",
                color: "inherit",
                borderRadius: 3,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.8em",
              }}
            >
              Use Mock Response
            </button>
          )}
        </div>
      )}

      {/* Output area */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 12px",
          background: "var(--bg-primary, #fff)",
        }}
      >
        {isRunning && (
          <span style={{ color: "var(--color-text-secondary, #888)", fontStyle: "italic" }}>
            Generating live response...
          </span>
        )}
        {!isRunning && activeSubTab === "proposals" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <AIProposalCards
              proposals={proposals}
              decisions={proposalDecisions}
              onSelect={(id) => setProposalDecision(id, "selected")}
              onReject={(id) => setProposalDecision(id, "rejected")}
              onClearDecision={(id) => setProposalDecision(id, "unreviewed")}
            />
            <AICommandPlanPreviewView
              plan={commandPlanPreview}
              onReviewApply={handleReviewApply}
              getApplyState={(item) => renameApplyByProposalId[item.proposalId]}
              isReviewApplyEnabled={(item) => getReviewApplyDecision(item).enabled}
              getReviewApplyDisabledReason={(item) => getReviewApplyDecision(item).reason}
            />
          </div>
        )}
        {!isRunning && activeSubTab !== "proposals" && result !== null && <MarkdownView text={result} />}
        {!isRunning && activeSubTab !== "proposals" && result === null && (
          <span style={{ color: "var(--color-text-secondary, #aaa)", fontStyle: "italic" }}>
            {activeSubTab === "ask"
              ? "Enter a question above and press Ask."
              : "Press the button above to generate an advisory review."}
          </span>
        )}
      </div>
    </div>
  );
}
