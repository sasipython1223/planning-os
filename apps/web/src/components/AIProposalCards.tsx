import type { CSSProperties } from "react";
import type { AIProposalCard, AIProposalDecision } from "../services/aiProposals";

interface AIProposalCardsProps {
  proposals: readonly AIProposalCard[];
  decisions: Readonly<Record<string, AIProposalDecision>>;
  onSelect: (id: string) => void;
  onReject: (id: string) => void;
  onClearDecision: (id: string) => void;
}

export function AIProposalCards({
  proposals,
  decisions,
  onSelect,
  onReject,
  onClearDecision,
}: AIProposalCardsProps) {
  if (proposals.length === 0) {
    return (
      <div style={{ color: "var(--color-text-secondary, #888)", fontStyle: "italic", fontSize: "0.85em" }}>
        No deterministic proposals were generated from the current snapshot.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {proposals.map((proposal) => {
        const decision = decisions[proposal.id] ?? "unreviewed";
        const badgeColor =
          decision === "selected"
            ? "#2e7d32"
            : decision === "rejected"
              ? "#c62828"
              : "#546e7a";

        return (
          <div
            key={proposal.id}
            data-testid={`proposal-card-${proposal.id}`}
            style={{
              border: "1px solid var(--border-default, #d7d7d7)",
              borderRadius: 4,
              padding: "8px 10px",
              background: "var(--bg-surface, #fafafa)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: "0.88em" }}>{proposal.title}</strong>
              <span
                style={{
                  fontSize: "0.72em",
                  textTransform: "uppercase",
                  color: badgeColor,
                  border: `1px solid ${badgeColor}`,
                  borderRadius: 10,
                  padding: "1px 6px",
                }}
              >
                {decision}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: "0.72em", color: "var(--color-text-secondary, #666)" }}>
                {proposal.type}
              </span>
            </div>

            <p style={{ margin: "0 0 6px 0", fontSize: "0.82em", lineHeight: 1.4 }}>
              {proposal.rationale}
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6, fontSize: "0.76em", color: "var(--color-text-secondary, #666)" }}>
              {proposal.confidence ? <span>Confidence: {proposal.confidence}</span> : null}
              {proposal.severity ? <span>Severity: {proposal.severity}</span> : null}
              {proposal.target?.taskId ? <span>Task: {proposal.target.taskId}</span> : null}
              {proposal.target?.wbsId ? <span>WBS: {proposal.target.wbsId}</span> : null}
              {proposal.target?.predTaskId && proposal.target?.succTaskId ? (
                <span>
                  Link: {proposal.target.predTaskId} -&gt; {proposal.target.succTaskId}
                </span>
              ) : null}
              <span>Advisory only</span>
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => onSelect(proposal.id)}
                style={buttonStyle(decision === "selected")}
              >
                Select
              </button>
              <button
                type="button"
                onClick={() => onReject(proposal.id)}
                style={buttonStyle(decision === "rejected")}
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => onClearDecision(proposal.id)}
                style={buttonStyle(decision === "unreviewed")}
              >
                Clear
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buttonStyle(active: boolean): CSSProperties {
  return {
    fontSize: "0.78em",
    padding: "3px 8px",
    border: "1px solid var(--border-default, #bbb)",
    background: active ? "var(--bg-primary, #fff)" : "transparent",
    borderRadius: 3,
    cursor: "pointer",
  };
}
