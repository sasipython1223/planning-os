import { useCallback, useEffect, useRef, useState } from "react";

interface EditableCellProps {
  value: string;
  onCommit: (newValue: string) => void;
  /** Render the read-only display content. Receives the authoritative value. */
  children: React.ReactNode;
}

/**
 * Inline-editable cell with fully isolated local state.
 * - Double-click enters edit mode
 * - Escape cancels and restores original value
 * - Enter or blur commits via onCommit
 * - Keystroke state lives only inside this component
 */
export function EditableCell({ value, onCommit, children }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // When entering edit mode, sync draft from authoritative value
  const startEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  // Focus input when edit mode activates
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== value) {
      onCommit(trimmed);
    }
  }, [draft, value, onCommit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      } else if (e.key === "Enter") {
        e.stopPropagation();
        commit();
      }
    },
    [cancel, commit],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          padding: "0 4px",
          margin: 0,
          border: "1px solid #1565c0",
          borderRadius: 2,
          fontSize: "inherit",
          fontFamily: "inherit",
          lineHeight: "inherit",
          outline: "none",
        }}
      />
    );
  }

  return (
    <div
      onDoubleClick={startEdit}
      style={{ width: "100%", height: "100%", cursor: "text" }}
    >
      {children}
    </div>
  );
}
