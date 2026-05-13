import type { AICommandPlanPreview, AICommandPlanPreviewItem } from "../services/aiCommandPlan";

type AICommandPlanApplyState = {
  status: "requested" | "applied" | "failed";
  message?: string;
};

interface AICommandPlanPreviewProps {
  plan: AICommandPlanPreview | null;
  onReviewApply?: (item: AICommandPlanPreviewItem) => void;
  getApplyState?: (item: AICommandPlanPreviewItem) => AICommandPlanApplyState | undefined;
  isReviewApplyEnabled?: (item: AICommandPlanPreviewItem) => boolean;
  getReviewApplyDisabledReason?: (item: AICommandPlanPreviewItem) => string | undefined;
}

export function AICommandPlanPreview({
  plan,
  onReviewApply,
  getApplyState,
  isReviewApplyEnabled,
  getReviewApplyDisabledReason,
}: AICommandPlanPreviewProps) {
  if (!plan) {
    return (
      <div
        data-testid="command-plan-empty"
        style={{
          border: "1px dashed var(--border-default, #d7d7d7)",
          borderRadius: 4,
          padding: "10px 12px",
          color: "var(--color-text-secondary, #666)",
          fontStyle: "italic",
          fontSize: "0.83em",
        }}
      >
        Select one or more proposals to preview the command plan.
      </div>
    );
  }

  return (
    <section
      data-testid="command-plan-preview"
      style={{
        border: "1px solid var(--border-default, #d7d7d7)",
        borderRadius: 4,
        background: "var(--bg-surface, #fafafa)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: "0.9em" }}>Command Preview</strong>
        <span style={{ fontSize: "0.74em", color: "var(--color-text-secondary, #666)" }}>
          {plan.summary.totalItems} item(s)
        </span>
      </div>

      <div
        style={{
          marginBottom: 8,
          background: "#fff7d1",
          border: "1px solid #f0db84",
          borderRadius: 4,
          padding: "6px 8px",
          fontSize: "0.8em",
          color: "#5a4600",
        }}
      >
        {plan.previewOnlyLabel}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plan.items.map((item) => {
          const statusColor =
            item.status === "blocked"
              ? "#c62828"
              : item.status === "warning"
                ? "#ef6c00"
                : "#2e7d32";
          const canReviewApply =
            item.category === "command" &&
            item.commandKind === "UPDATE_TASK" &&
            item.proposalType === "improve-activity-name" &&
            typeof onReviewApply === "function";
          const applyState = getApplyState?.(item);
          const applyEnabled = canReviewApply && (isReviewApplyEnabled ? isReviewApplyEnabled(item) : true);
          const applyDisabledReason = canReviewApply ? getReviewApplyDisabledReason?.(item) : undefined;

          return (
            <article
              key={item.id}
              data-testid={`command-plan-item-${item.id}`}
              style={{
                border: "1px solid var(--border-default, #ddd)",
                borderRadius: 4,
                background: "var(--bg-primary, #fff)",
                padding: "8px 10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: "0.84em" }}>{item.proposalTitle}</strong>
                <span
                  style={{
                    fontSize: "0.72em",
                    color: statusColor,
                    border: `1px solid ${statusColor}`,
                    borderRadius: 10,
                    padding: "1px 6px",
                    textTransform: "uppercase",
                  }}
                >
                  {item.status}
                </span>
              </div>

              {item.category === "command" ? (
                <div style={{ display: "grid", rowGap: 3, fontSize: "0.8em" }}>
                  <div><strong>Command:</strong> {item.commandKind}</div>
                  <div><strong>Target:</strong> {item.targetLabel}</div>
                  <div><strong>Payload:</strong> {item.payloadSummary}</div>
                </div>
              ) : (
                <div style={{ display: "grid", rowGap: 3, fontSize: "0.8em" }}>
                  <div><strong>{item.advisoryLabel}</strong></div>
                  <div>{item.payloadSummary}</div>
                </div>
              )}

              {item.notices.length > 0 ? (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3, fontSize: "0.78em" }}>
                  {item.notices.map((notice, idx) => (
                    <div key={`${item.id}:${idx}`}>
                      <strong>{notice.severity === "blocker" ? "Blocker:" : "Warning:"}</strong> {notice.message}
                    </div>
                  ))}
                </div>
              ) : null}

              {canReviewApply ? (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onReviewApply?.(item)}
                    disabled={!applyEnabled}
                    title={!applyEnabled ? applyDisabledReason : "Review and apply rename"}
                    style={{
                      fontSize: "0.78em",
                      padding: "3px 8px",
                      border: "1px solid var(--border-default, #bbb)",
                      background: "var(--bg-primary, #fff)",
                      borderRadius: 3,
                      cursor: applyEnabled ? "pointer" : "default",
                      opacity: applyEnabled ? 1 : 0.65,
                    }}
                  >
                    Review Apply
                  </button>
                  {applyState ? (
                    <span
                      style={{
                        fontSize: "0.76em",
                        color:
                          applyState.status === "applied"
                            ? "#2e7d32"
                            : applyState.status === "failed"
                              ? "#c62828"
                              : "#546e7a",
                      }}
                    >
                      {applyState.status === "requested"
                        ? "Requested"
                        : applyState.status === "applied"
                          ? "Applied"
                          : "Failed"}
                      {applyState.message ? `: ${applyState.message}` : ""}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
