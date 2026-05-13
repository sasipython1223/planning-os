import type { Assignment, BaselineMap, CalendarId, ConstraintType, Dependency, DependencyDiagnosticsMap, DependencyType, DiagnosticsMap, FloatPathMvpError, FloatPathMvpResponse, ImportFormat, PlannerCalendar, Resource, ResourceHistogram, ScheduleLifecycleState, ScheduleResultMap, SourceCalculatedVarianceReport, SourceImportFidelityState, SourceImportRecord, Task, VarianceMap, VisibleRow, WorkerMessage, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AIReviewPanel } from "./components/AIReviewPanel";
import { CalendarSettingsPanel } from "./components/CalendarSettingsPanel";
import type { DrivingLogicTaskDisplay } from "./components/DrivingLogicPanel";
import { DrivingLogicPanel } from "./components/DrivingLogicPanel";
import type { FloatPathTaskDisplay } from "./components/FloatPathPanel";
import { FloatPathPanel } from "./components/FloatPathPanel";
import { GanttPane } from "./components/gantt/GanttPane";
import { TIMESCALE_PROFILES, type TimescaleProfileId } from "./components/gantt/timescaleModel";
import { HistogramPane } from "./components/HistogramPane";
import { ImportDetailsPanel } from "./components/ImportDetailsPanel";
import { ImportPreviewPanel, type ImportPreviewData } from "./components/ImportPreviewPanel";
import { ScheduleDashboard } from "./components/ScheduleDashboard";
import { SourcePlannerRecalculationReportPanel } from "./components/SourcePlannerRecalculationReportPanel";
import { TaskContextMenu, type TaskContextMenuAction } from "./components/TaskContextMenu";
import { TaskDetailsPanel } from "./components/TaskDetailsPanel";
import { getSelectedActivityId, getSelectedTaskAssignments, getSelectedTaskDependencies } from "./components/taskDetailsScope";
import { TASK_COLUMN_REGISTRY, TaskTable } from "./components/TaskTable";
import { classifyCalendarRisk } from "./services/calendarRisk";
import type { ImmediateDrivingLogicResult } from "./services/drivingLogic";
import { deriveImmediateDrivingLogic } from "./services/drivingLogic";
import { deriveDefaultFloatPathAutoViewFilter } from "./services/floatPathAutoView";
import { deriveFloatPathProjection, type FloatPathLayoutMode, type FloatPathViewFilter, type FloatPathWbsContextDepth } from "./services/floatPathProjection";
import { buildImportDetailsViewModel } from "./services/importDetailsViewModel";
import { buildScheduleSnapshot } from "./services/scheduleSnapshot";
import { buildSourcePlannerRecalculationReport } from "./services/sourcePlannerReportViewModel";
import { BottomDrawer } from "./ui/components/drawer/BottomDrawer";
import { MainWorkspace } from "./ui/components/shell/MainWorkspace";
import { WorkspaceContainer } from "./ui/components/shell/WorkspaceContainer";
import { WorkspaceSplitter } from "./ui/components/WorkspaceSplitter";
import { HEADER_METRICS } from "./ui/config/themeConfig";
import { useDensityMetrics, useUIStore } from "./ui/store/uiStore";
import { DATE_DISPLAY_FORMAT_OPTIONS, type DateDisplayFormat } from "./utils/dateProjection";
import { filterByConstraint, type ConstraintFilter } from "./utils/filterByConstraint";
import { computeTimelineGeometry } from "./utils/timelineGeometry";
import {
    installWorkerDevHooks,
    isDevOrTestMode,
    runTemporalAuthorityDiagnostics,
    uninstallWorkerDevHooks,
} from "./utils/workerDevHooks";

export type Selection = { type: "task"; id: string } | { type: "dependency"; id: string } | null;
type MenuId = "file" | "edit" | "view" | "insert" | "structure" | "baseline" | "help";
type QuickAddContext =
  | { kind: "valid"; parentId: string | null; sourceTaskId: string }
  | { kind: "invalid"; reason: string };

function makeId() {
  return crypto.randomUUID();
}

type AIRenameApplyStatus = "requested" | "applied" | "failed";

type AIRenameApplyEntry = {
  status: AIRenameApplyStatus;
  taskId: string;
  proposedName: string;
  reqId?: string;
  message?: string;
};

type AIRenameApplyMap = Record<string, AIRenameApplyEntry>;

export default function App() {
  const visibleTimescaleProfiles: TimescaleProfileId[] = [
    "year-month",
    "year-quarter",
    "quarter-month",
    "month-only",
    "week-day",
  ];

  const { rowHeight } = useDensityMetrics();
  const isBottomOpen = useUIStore((s) => s.isBottomOpen);
  const activeBottomTab = useUIStore((s) => s.activeBottomTab);
  const setActiveBottomTab = useUIStore((s) => s.setActiveBottomTab);
  const toggleBottomDrawer = useUIStore((s) => s.toggleBottomDrawer);
  const setStatusText = useUIStore((s) => s.setStatusText);
  const setTemporalAuthorityDiagnostics = useUIStore((s) => s.setTemporalAuthorityDiagnostics);
  const constraintFilter = useUIStore((s) => s.constraintFilter);
  const setConstraintFilter = useUIStore((s) => s.setConstraintFilter);
  const tableWidth = useUIStore((s) => s.tableWidth);
  const dateDisplayFormat = useUIStore((s) => s.dateDisplayFormat);
  const setDateDisplayFormat = useUIStore((s) => s.setDateDisplayFormat);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const mainContentRowRef = useRef<HTMLDivElement>(null);
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const ganttBodyRef = useRef<HTMLDivElement>(null);
  const histogramAxisRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [taskName, setTaskName] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [scheduleResults, setScheduleResults] = useState<ScheduleResultMap>({});
  const [workerReady, setWorkerReady] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [projectStartDate, setProjectStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const scrollTrackRef = useRef<HTMLDivElement>(null);
  // Worker-owned hierarchy state — UI never computes collapse visibility
  const [workerVisibleRows, setWorkerVisibleRows] = useState<VisibleRow[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [nonWorkingDays, setNonWorkingDays] = useState<ReadonlySet<number>>(new Set());
  const [baselines, setBaselines] = useState<BaselineMap>({});
  const [variances, setVariances] = useState<VarianceMap>({});
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [resources, setResources] = useState<Resource[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [resourceName, setResourceName] = useState("");
  const [resourceHistogram, setResourceHistogram] = useState<ResourceHistogram>({});
  const [diagnosticsMap, setDiagnosticsMap] = useState<DiagnosticsMap>({});
  const [dependencyDiagnosticsMap, setDependencyDiagnosticsMap] = useState<DependencyDiagnosticsMap>({});
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [timescaleProfileId, setTimescaleProfileId] = useState<TimescaleProfileId>("year-month");
  const [manualPixelsPerDayOverride, setManualPixelsPerDayOverride] = useState<number | null>(null);
  const [showDependencies, setShowDependencies] = useState(true);
  const [aiRenameApplyByProposalId, setAiRenameApplyByProposalId] = useState<AIRenameApplyMap>({});
  const aiRenameReqToProposalRef = useRef<Map<string, string>>(new Map());
  const aiRenameAckedReqRef = useRef<Set<string>>(new Set());
  const [hiddenTaskColumns, setHiddenTaskColumns] = useState<ReadonlySet<string>>(
    () => new Set(TASK_COLUMN_REGISTRY.filter((c) => !c.visibleByDefault).map((c) => c.id)),
  );
  const [_ganttScrollLeft, setGanttScrollLeft] = useState(0);
  const [_ganttPaneWidth, setGanttPaneWidth] = useState(0);
  const ganttScrollElRef = useRef<HTMLDivElement | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null);
  const [floatPathResult, setFloatPathResult] = useState<FloatPathMvpResponse | null>(null);
  const [floatPathError, setFloatPathError] = useState<FloatPathMvpError | null>(null);
  const [floatPathRunning, setFloatPathRunning] = useState(false);
  const [floatPathStale, setFloatPathStale] = useState(false);
  const [floatPathViewFilter, setFloatPathViewFilter] = useState<FloatPathViewFilter>({ mode: "off" });
  const [floatPathLayoutMode, setFloatPathLayoutMode] = useState<FloatPathLayoutMode>("originalWbs");
  const [floatPathWbsContextDepth, setFloatPathWbsContextDepth] = useState<FloatPathWbsContextDepth>("full");
  const [scheduleLifecycle, setScheduleLifecycle] = useState<ScheduleLifecycleState>("empty");
  const [sourceImportRecord, setSourceImportRecord] = useState<SourceImportRecord | null>(null);
  const [sourceCalculatedVarianceReport, setSourceCalculatedVarianceReport] = useState<SourceCalculatedVarianceReport | null>(null);
  const [sourceImportFidelityState, setSourceImportFidelityState] = useState<SourceImportFidelityState>({ actualsByTaskId: {}, progressByTaskId: {} });
  const [isImportDetailsOpen, setIsImportDetailsOpen] = useState(false);
  const [isSourcePlannerReportOpen, setIsSourcePlannerReportOpen] = useState(false);
  const [isCalendarSettingsOpen, setIsCalendarSettingsOpen] = useState(false);
  const [plannerCalendars, setPlannerCalendars] = useState<Record<string, PlannerCalendar>>({});
  const floatPathReqIdRef = useRef<string | null>(null);
  const lastFloatPathRunInputRef = useRef<{
    targetTaskId: string;
    maxPaths: number;
    nearCriticalThresholdMinutes: number;
  } | null>(null);
  const autoRefreshFloatPathAfterDependencyMutationRef = useRef(false);
  const pendingFloatPathMutationReqIdRef = useRef<string | null>(null);
  const pendingFloatPathContextActionRef = useRef<{
    source: "right-click-to-activity";
    targetTaskId: string;
    reqId: string;
  } | null>(null);
  const hasFloatPathResultRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menubarRef = useRef<HTMLDivElement>(null);

  // ── Context menu state (TD-TRACE.2A) ──────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    taskId: string;
    position: { x: number; y: number };
    isSummary: boolean;
    hasScheduleResult: boolean;
  } | null>(null);

  // ── Driving logic trace state (TD-TRACE.2B) ────────────────────────────
  const [drivingLogicResult, setDrivingLogicResult] = useState<ImmediateDrivingLogicResult | null>(null);
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);

  const toggleMenu = useCallback((menuId: MenuId) => {
    setActiveMenu((prev) => (prev === menuId ? null : menuId));
  }, []);

  useEffect(() => {
    if (activeMenu === null) return;

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menubarRef.current?.contains(target)) return;
      setActiveMenu(null);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveMenu(null);
      }
    };

    document.addEventListener("click", onDocumentClick);
    window.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      window.removeEventListener("keydown", onEscape);
    };
  }, [activeMenu]);

  const handleGanttHScrollMount = useCallback((el: HTMLDivElement | null) => {
    ganttScrollElRef.current = el;
  }, []);

  // ── Import flow callbacks ──────────────────────────────────────────

  const handleImportFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workerRef.current) return;
    // Reset input so the same file can be re-selected
    e.target.value = "";

    const ext = file.name.split(".").pop()?.toLowerCase();
    let format: ImportFormat;
    if (ext === "xer") {
      format = "xer";
    } else if (ext === "xml") {
      format = "msp-xml";
    } else {
      setLogs((prev) => [`Import: unsupported file extension ".${ext}"`, ...prev]);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !workerRef.current) return;
      workerRef.current.postMessage({
        type: "PREVIEW_IMPORT",
        v: 1,
        reqId: makeId(),
        payload: { format, content: reader.result, sourceFileName: file.name },
      });
    };
    reader.readAsText(file);
  }, []);

  const handleImportCommit = useCallback(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "IMPORT_SCHEDULE", v: 1, reqId: makeId() });
    setImportPreview(null);
  }, []);

  const handleImportCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "CANCEL_IMPORT_PREVIEW", v: 1, reqId: makeId() });
    }
    setImportPreview(null);
  }, []);

  const handleRunRecalculation = useCallback(() => {
    if (!workerRef.current) return;

    const risk = classifyCalendarRisk(
      sourceImportRecord?.summary.calendarFidelity,
      sourceImportRecord?.diagnostics ?? [],
    );

    if (risk.level === "high") {
      const proceed = window.confirm(
        "Planner recalculation may not match P6 because imported task calendars / calendar details are preserved but not fully active in the current scheduling engine.\n\nProceed with Planner recalculation?",
      );
      if (!proceed) return;
    }

    workerRef.current.postMessage({ type: "RUN_IMPORTED_SCHEDULE_RECALCULATION", v: 1, reqId: makeId() });
  }, [sourceImportRecord]);

  const handleSavePlannerCalendar = useCallback((calendar: PlannerCalendar) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "UPSERT_PLANNER_CALENDAR", v: 1, reqId: makeId(), payload: calendar });
  }, []);

  const handleCloneImportedCalendar = useCallback((sourceCalendarId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "CLONE_IMPORTED_CALENDAR", v: 1, reqId: makeId(), sourceCalendarId });
  }, []);

  const handleSetProjectDefaultCalendar = useCallback((calendarId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "SET_PROJECT_DEFAULT_CALENDAR", v: 1, reqId: makeId(), calendarId });
  }, []);

  const handleAssignCalendarToActivities = useCallback((calendarId: string, taskIds: readonly string[]) => {
    if (!workerRef.current || taskIds.length === 0) return;
    workerRef.current.postMessage({ type: "ASSIGN_CALENDAR_TO_ACTIVITIES", v: 1, reqId: makeId(), calendarId, taskIds });
  }, []);

  const toggleTaskColumnVisibility = useCallback((columnId: string) => {
    if (columnId === "wbs" || columnId === "id") return;
    setHiddenTaskColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  }, []);

  // Shared timeline geometry — single owner for both Gantt and Histogram
  const timeline = useMemo(
    () => computeTimelineGeometry(scheduleResults, projectStartDate),
    [scheduleResults, projectStartDate],
  );
  const monthCountToFinishEnabled = Object.keys(scheduleResults).length > 0 && timeline.maxDay > 0;

  useEffect(() => {
    if (!monthCountToFinishEnabled && timescaleProfileId === "month-count-to-finish") {
      setTimescaleProfileId("month-count-from-start");
    }
  }, [monthCountToFinishEnabled, timescaleProfileId]);

  // Worker provides visibleRows already filtered for collapse state.
  // UI only applies the constraint filter on top.
  const visibleTasks = useMemo(
    () => filterByConstraint(workerVisibleRows, constraintFilter),
    [workerVisibleRows, constraintFilter],
  );

  const floatPathProjection = useMemo(
    () =>
      deriveFloatPathProjection({
        rows: visibleTasks,
        result: floatPathResult,
        filter: floatPathViewFilter,
        layout: floatPathLayoutMode,
        stale: floatPathStale,
        wbsContextDepth: floatPathWbsContextDepth,
      }),
    [visibleTasks, floatPathResult, floatPathViewFilter, floatPathLayoutMode, floatPathStale],
  );

  const displayedRows = floatPathProjection.projectedRows;
  const isFloatPathFilteredViewActive = floatPathProjection.isActive;
  const floatPathProjectionWarning = floatPathProjection.warnings[0];

  const phantomHeight = displayedRows.length * rowHeight;

  // Read-only AI snapshot — pure projection of current App state.
  // No worker refs, no commands — safe to pass to AIReviewPanel.
  const aiSnapshot = useMemo(
    () =>
      buildScheduleSnapshot(
        tasks,
        workerVisibleRows,
        dependencies,
        scheduleResults,
        diagnosticsMap,
        projectStartDate,
        variances,
        baselines,
      ),
    [tasks, workerVisibleRows, dependencies, scheduleResults, diagnosticsMap, projectStartDate, variances, baselines],
  );

  const importDetailsViewModel = useMemo(
    () =>
      buildImportDetailsViewModel({
        sourceImportRecord,
        sourceImportFidelityState,
        scheduleLifecycle,
        sourceCalculatedVarianceReport,
        tasks,
        visibleRows: workerVisibleRows,
        projectStartDate,
        dateDisplayFormat,
      }),
    [
      sourceImportRecord,
      sourceImportFidelityState,
      scheduleLifecycle,
      sourceCalculatedVarianceReport,
      tasks,
      workerVisibleRows,
      projectStartDate,
      dateDisplayFormat,
    ],
  );

  const sourcePlannerReportViewModel = useMemo(
    () => {
      if (!sourceImportRecord || !sourceCalculatedVarianceReport) return null;
      return buildSourcePlannerRecalculationReport({
        sourceImportRecord,
        sourceImportFidelityState,
        sourceCalculatedVarianceReport,
        tasks,
        scheduleResults,
        projectStartDate,
        dateDisplayFormat,
      });
    },
    [
      sourceImportRecord,
      sourceImportFidelityState,
      sourceCalculatedVarianceReport,
      tasks,
      scheduleResults,
      projectStartDate,
      dateDisplayFormat,
    ],
  );

  const projectDefaultCalendarId = useMemo<CalendarId>(
    () => Object.values(plannerCalendars).find((c) => c.isDefaultProjectCalendar)?.calendarId ?? ("default" as CalendarId),
    [plannerCalendars],
  );

  useEffect(() => {
    if (!sourceImportRecord) {
      setIsImportDetailsOpen(false);
      setIsSourcePlannerReportOpen(false);
    }
  }, [sourceImportRecord]);

  useEffect(() => {
    if (!sourceCalculatedVarianceReport) {
      setIsSourcePlannerReportOpen(false);
    }
  }, [sourceCalculatedVarianceReport]);

  // Push status text into TopBar via store
  useEffect(() => {
    setStatusText(
      `Tasks: ${tasks.length} | Deps: ${dependencies.length} | Scheduled: ${Object.keys(scheduleResults).length} | Worker: ${workerReady ? 'Ready' : 'Starting...'}`
    );
  }, [tasks.length, dependencies.length, scheduleResults, workerReady, setStatusText]);

  // Clamp scroll after collapse/filter changes to avoid blank space.
  useEffect(() => {
    const el = scrollTrackRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, phantomHeight - viewportHeight);
    if (el.scrollTop > maxScroll) {
      el.scrollTop = maxScroll;
    }
  }, [phantomHeight, viewportHeight]);

  const handleScrollTrack = useCallback(() => {
    const el = scrollTrackRef.current;
    if (!el) return;
    const st = el.scrollTop;
    setScrollTop(st);
    if (tableBodyRef.current) tableBodyRef.current.scrollTop = st;
  }, []);

  // Forward mouse-wheel events from anywhere in the main content area
  // to the single vertical scroll owner (scroll track).
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = scrollTrackRef.current;
    if (!el || !e.deltaY) return;
    // Skip if the wheel originated inside the scroll track itself (native handles it)
    if (el.contains(e.target as Node)) return;
    el.scrollTop += e.deltaY;
  }, []);

  // Measure the scroll track viewport height (= visible body area)
  useEffect(() => {
    const el = scrollTrackRef.current;
    if (!el) return;

    const measure = () => {
      setViewportHeight(el.clientHeight);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../../packages/worker/worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;

      if (msg.type === "WORKER_READY") {
        setWorkerReady(true);
        setLogs((prev) => ["WORKER_READY", ...prev]);
      }

      if (msg.type === "ACK") {
        setLogs((prev) => [`ACK ${msg.reqId}`, ...prev]);
        if (aiRenameReqToProposalRef.current.has(msg.reqId)) {
          aiRenameAckedReqRef.current.add(msg.reqId);
        }
      }

      if (msg.type === "NACK") {
        setLogs((prev) => [`NACK ${msg.reqId}: ${msg.error}`, ...prev]);
        if (pendingFloatPathMutationReqIdRef.current === msg.reqId) {
          pendingFloatPathMutationReqIdRef.current = null;
          autoRefreshFloatPathAfterDependencyMutationRef.current = false;
        }
        if (floatPathReqIdRef.current === msg.reqId) {
          setFloatPathRunning(false);
          setFloatPathError({ type: "ComputationFailed", message: msg.error });
          setFloatPathStale(false);
          hasFloatPathResultRef.current = false;
          if (pendingFloatPathContextActionRef.current?.reqId === msg.reqId) {
            pendingFloatPathContextActionRef.current = null;
          }
        }
        const proposalId = aiRenameReqToProposalRef.current.get(msg.reqId);
        if (proposalId) {
          aiRenameReqToProposalRef.current.delete(msg.reqId);
          aiRenameAckedReqRef.current.delete(msg.reqId);
          setAiRenameApplyByProposalId((prev) => {
            const entry = prev[proposalId];
            if (!entry) return prev;
            return {
              ...prev,
              [proposalId]: {
                ...entry,
                status: "failed",
                message: msg.error,
              },
            };
          });
        }
      }

      if (msg.type === "SCHEDULE_ERROR") {
        setLogs((prev) => [`SCHEDULE_ERROR: ${msg.error.message}`, ...prev]);
      }

      if (msg.type === "DIFF_STATE") {
        setTasks(msg.payload.tasks);
        setDependencies(msg.payload.dependencies);
        setScheduleResults(msg.payload.scheduleResults);
        setBaselines(msg.payload.baselines);
        setVariances(msg.payload.variances);
        setProjectStartDate(msg.payload.projectStartDate);
        setNonWorkingDays(new Set(msg.payload.nonWorkingDays));
        setCanUndo(msg.payload.canUndo ?? false);
        setCanRedo(msg.payload.canRedo ?? false);
        setResources(msg.payload.resources ?? []);
        setAssignments(msg.payload.assignments ?? []);
        setResourceHistogram(msg.payload.resourceHistogram ?? {});
        setDiagnosticsMap(msg.payload.diagnosticsMap ?? {});
        setDependencyDiagnosticsMap(msg.payload.dependencyDiagnostics ?? {});
        setScheduleLifecycle(msg.payload.scheduleLifecycle ?? "empty");
        setSourceImportRecord(msg.payload.sourceImportRecord ?? null);
        setSourceCalculatedVarianceReport(msg.payload.sourceCalculatedVarianceReport ?? null);
        setSourceImportFidelityState(msg.payload.sourceImportFidelityState ?? { actualsByTaskId: {}, progressByTaskId: {} });
        setPlannerCalendars(msg.payload.plannerCalendars ?? {});
        // Worker-generated visible rows — already filtered for collapse state
        setWorkerVisibleRows(msg.payload.visibleRows ?? []);
        // Purge selection if the selected entity no longer exists
        setSelection((prev) => {
          if (!prev) return null;
          if (prev.type === "task" && !msg.payload.tasks.some(t => t.id === prev.id)) return null;
          if (prev.type === "dependency" && !msg.payload.dependencies.some(d => d.id === prev.id)) return null;
          return prev;
        });
        setSelectedTaskIds((prev) =>
          prev.filter((id) => msg.payload.tasks.some((t) => t.id === id))
        );
        setAiRenameApplyByProposalId((prev) => {
          let changed = false;
          const next: AIRenameApplyMap = { ...prev };

          for (const [proposalId, entry] of Object.entries(prev)) {
            if (entry.status !== "requested" || !entry.reqId) continue;
            if (!aiRenameAckedReqRef.current.has(entry.reqId)) continue;

            const targetTask = msg.payload.tasks.find((task) => task.id === entry.taskId);
            const applied = targetTask != null && targetTask.name.trim() === entry.proposedName;
            aiRenameReqToProposalRef.current.delete(entry.reqId);
            aiRenameAckedReqRef.current.delete(entry.reqId);

            next[proposalId] = {
              ...entry,
              status: applied ? "applied" : "failed",
              message: applied
                ? "Applied after schedule state refresh."
                : "Rename not applied after command acknowledgement.",
            };
            changed = true;
          }

          return changed ? next : prev;
        });
        setLogs((prev) => [
          `DIFF_STATE tasks=${msg.payload.tasks.length} deps=${msg.payload.dependencies.length} scheduled=${Object.keys(msg.payload.scheduleResults).length} lifecycle=${msg.payload.scheduleLifecycle}`,
          ...prev
        ]);
        if (
          autoRefreshFloatPathAfterDependencyMutationRef.current
          && lastFloatPathRunInputRef.current
          && workerRef.current
        ) {
          const nextReqId = makeId();
          const input = lastFloatPathRunInputRef.current;
          floatPathReqIdRef.current = nextReqId;
          autoRefreshFloatPathAfterDependencyMutationRef.current = false;
          pendingFloatPathMutationReqIdRef.current = null;
          pendingFloatPathContextActionRef.current = null;
          setFloatPathRunning(true);
          setFloatPathStale(false);
          setFloatPathError(null);
          workerRef.current.postMessage({
            type: "ANALYZE_FLOAT_PATHS",
            v: 1,
            reqId: nextReqId,
            targetTaskId: input.targetTaskId,
            maxPaths: input.maxPaths,
            nearCriticalThresholdMinutes: input.nearCriticalThresholdMinutes,
          });
          setLogs((prev) => [
            `ANALYZE_FLOAT_PATHS auto-refresh req=${nextReqId} target=${input.targetTaskId} maxPaths=${input.maxPaths} threshold=${input.nearCriticalThresholdMinutes}`,
            ...prev,
          ]);
        } else if (hasFloatPathResultRef.current) {
          setFloatPathStale(true);
        }
      }

      if (msg.type === "VISIBLE_ROWS_UPDATE") {
        setWorkerVisibleRows(msg.payload.visibleRows);
      }

      if (msg.type === "IMPORT_PREVIEW") {
        setImportPreview(msg.payload);
        setLogs((prev) => [
          `IMPORT_PREVIEW project="${msg.payload.projectName}" file=${msg.payload.sourceFileName ?? "(unknown)"} tasks=${msg.payload.summary.taskCount} canCommit=${msg.payload.canCommit}`,
          ...prev,
        ]);
      }

      if (msg.type === "FLOAT_PATH_RESULT") {
        if (floatPathReqIdRef.current !== null && msg.reqId !== floatPathReqIdRef.current) {
          setLogs((prev) => [`FLOAT_PATH_RESULT ignored (stale reqId=${msg.reqId})`, ...prev]);
          return;
        }
        setFloatPathResult(msg.payload);
        setFloatPathError(null);
        setFloatPathRunning(false);
        setFloatPathStale(false);
        hasFloatPathResultRef.current = true;
        setLogs((prev) => [
          `FLOAT_PATH_RESULT req=${msg.reqId} paths=${msg.payload.summary.returnedPathCount} target=${msg.payload.target.taskId}`,
          ...prev,
        ]);

        if (pendingFloatPathContextActionRef.current?.reqId === msg.reqId) {
          setActiveBottomTab("float-path");
          const autoFilter = deriveDefaultFloatPathAutoViewFilter(msg.payload);
          if (autoFilter) {
            setFloatPathViewFilter(autoFilter);
          }
          pendingFloatPathContextActionRef.current = null;
        }
      }

      if (msg.type === "FLOAT_PATH_ERROR") {
        if (floatPathReqIdRef.current !== null && msg.reqId !== floatPathReqIdRef.current) {
          setLogs((prev) => [`FLOAT_PATH_ERROR ignored (stale reqId=${msg.reqId})`, ...prev]);
          return;
        }

        if (pendingFloatPathContextActionRef.current?.reqId === msg.reqId) {
          pendingFloatPathContextActionRef.current = null;
        }

        setFloatPathError(msg.error);
        setFloatPathRunning(false);
        setFloatPathStale(false);
        hasFloatPathResultRef.current = false;
        setLogs((prev) => [`FLOAT_PATH_ERROR req=${msg.reqId}: ${msg.error.type} ${msg.error.message}`, ...prev]);
      }
    };

    // Install dev/test-only diagnostic hooks (dev mode only)
    installWorkerDevHooks(worker);

    let isDisposed = false;
    let diagnosticsInterval: ReturnType<typeof setInterval> | null = null;

    const refreshTemporalAuthorityDiagnostics = async () => {
      if (isDisposed || !workerRef.current || !isDevOrTestMode()) return;
      try {
        const diagnostics = await runTemporalAuthorityDiagnostics(workerRef.current);
        if (!isDisposed) {
          setTemporalAuthorityDiagnostics(diagnostics);
        }
      } catch {
        if (!isDisposed) {
          setTemporalAuthorityDiagnostics(null);
        }
      }
    };

    if (isDevOrTestMode()) {
      void refreshTemporalAuthorityDiagnostics();
      diagnosticsInterval = setInterval(() => {
        void refreshTemporalAuthorityDiagnostics();
      }, 2000);
    }

    return () => {
      isDisposed = true;
      if (diagnosticsInterval) {
        clearInterval(diagnosticsInterval);
      }
      setTemporalAuthorityDiagnostics(null);
      uninstallWorkerDevHooks(worker);
      worker.terminate();
      workerRef.current = null;
    };
  }, [setTemporalAuthorityDiagnostics]);

  // W5B-B2.12A.2: dev-only diagnostic window mirror.
  // Exposes a read-only snapshot of the main-thread mirror of worker state
  // for calendar-binding audits run from the page console. Has no effect
  // outside dev/test mode and never mutates any state.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as {
      __diagnosticState?: {
        tasks: Task[];
        dependencies: Dependency[];
        plannerCalendars: Record<string, PlannerCalendar>;
        sourceImportRecord: SourceImportRecord | null;
        projectStartDate: string;
      };
    }).__diagnosticState = {
      tasks,
      dependencies,
      plannerCalendars,
      sourceImportRecord,
      projectStartDate,
    };
  }, [tasks, dependencies, plannerCalendars, sourceImportRecord, projectStartDate]);

  const handleRunFloatPathAnalysis = useCallback((
    input: {
      targetTaskId: string;
      maxPaths: number;
      nearCriticalThresholdMinutes: number;
    },
    options?: {
      source?: "manual" | "right-click-to-activity";
    },
  ) => {
    if (!workerRef.current || !workerReady) return;

    const reqId = makeId();
    const normalizedInput = {
      targetTaskId: input.targetTaskId,
      maxPaths: Math.max(1, Math.round(input.maxPaths)),
      nearCriticalThresholdMinutes: Math.max(0, Math.round(input.nearCriticalThresholdMinutes)),
    };
    const source = options?.source ?? "manual";
    lastFloatPathRunInputRef.current = normalizedInput;
    floatPathReqIdRef.current = reqId;
    autoRefreshFloatPathAfterDependencyMutationRef.current = false;
    pendingFloatPathMutationReqIdRef.current = null;
    if (source === "right-click-to-activity") {
      pendingFloatPathContextActionRef.current = {
        source,
        targetTaskId: normalizedInput.targetTaskId,
        reqId,
      };
    } else {
      pendingFloatPathContextActionRef.current = null;
    }
    setFloatPathRunning(true);
    setFloatPathStale(false);
    setFloatPathResult(null);
    setFloatPathError(null);
    hasFloatPathResultRef.current = false;

    workerRef.current.postMessage({
      type: "ANALYZE_FLOAT_PATHS",
      v: 1,
      reqId,
      targetTaskId: normalizedInput.targetTaskId,
      maxPaths: normalizedInput.maxPaths,
      nearCriticalThresholdMinutes: normalizedInput.nearCriticalThresholdMinutes,
    });

    setLogs((prev) => [
      `ANALYZE_FLOAT_PATHS req=${reqId} target=${normalizedInput.targetTaskId} maxPaths=${normalizedInput.maxPaths} threshold=${normalizedInput.nearCriticalThresholdMinutes}`,
      ...prev,
    ]);
  }, [workerReady]);

  // ── Context menu handlers (TD-TRACE.2A) ───────────────────────────────

  const handleOpenContextMenu = useCallback((
    taskId: string,
    position: { x: number; y: number },
    isSummary: boolean,
    hasScheduleResult: boolean,
  ) => {
    setContextMenu({ taskId, position, isSummary, hasScheduleResult });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuAction = useCallback((action: TaskContextMenuAction) => {
    const taskId = contextMenu?.taskId;
    if (!taskId) return;

    // Select the row in all cases
    setSelection({ type: "task", id: taskId });
    setSelectedTaskIds([taskId]);

    if (action === "open-relationships") {
      // Open Task Details panel — the Relationships tab is the default visible section.
      setActiveBottomTab("task-details");
    } else if (action === "show-driving-logic") {
      // Derive immediate driving logic from precomputed dependencyDiagnostics.
      // No CPM, no date arithmetic — only reads isDriving booleans from worker projection.
      const result = deriveImmediateDrivingLogic({
        sourceTaskId: taskId,
        dependencies,
        dependencyDiagnosticsMap,
      });
      setDrivingLogicResult(result);
      setActiveBottomTab("driving-logic");
    } else if (action === "set-float-path-target") {
      // The FloatPathPanel reads selectedTask from App selection state.
      // Opening the panel is sufficient — the user can then click Analyze.
      setActiveBottomTab("float-path");
    } else if (action === "show-float-paths") {
      // Run existing float path analysis with this activity as target.
      // Uses defaults consistent with the FloatPathPanel initial state.
      setActiveBottomTab("float-path");
      handleRunFloatPathAnalysis({
        targetTaskId: taskId,
        maxPaths: 5,
        nearCriticalThresholdMinutes: 480,
      }, { source: "right-click-to-activity" });
    }
  }, [contextMenu, dependencies, dependencyDiagnosticsMap, setActiveBottomTab, handleRunFloatPathAnalysis]);

  const handleClearDrivingLogic = useCallback(() => {
    setDrivingLogicResult(null);
  }, []);

  const handleApplyAiRename = useCallback((input: {
    proposalId: string;
    taskId: string;
    currentName: string;
    proposedName: string;
  }) => {
    const proposedName = input.proposedName.trim();
    if (proposedName.length === 0) {
      setAiRenameApplyByProposalId((prev) => ({
        ...prev,
        [input.proposalId]: {
          status: "failed",
          taskId: input.taskId,
          proposedName,
          message: "Proposed name is empty.",
        },
      }));
      return;
    }

    if (input.currentName.trim() === proposedName) {
      setAiRenameApplyByProposalId((prev) => ({
        ...prev,
        [input.proposalId]: {
          status: "failed",
          taskId: input.taskId,
          proposedName,
          message: "Proposed name matches current name.",
        },
      }));
      return;
    }

    if (!workerRef.current) {
      setAiRenameApplyByProposalId((prev) => ({
        ...prev,
        [input.proposalId]: {
          status: "failed",
          taskId: input.taskId,
          proposedName,
          message: "Worker not ready.",
        },
      }));
      return;
    }

    const reqId = makeId();
    aiRenameReqToProposalRef.current.set(reqId, input.proposalId);
    aiRenameAckedReqRef.current.delete(reqId);

    setAiRenameApplyByProposalId((prev) => ({
      ...prev,
      [input.proposalId]: {
        status: "requested",
        taskId: input.taskId,
        proposedName,
        reqId,
        message: "Rename requested.",
      },
    }));

    workerRef.current.postMessage({
      type: "UPDATE_TASK",
      v: 1,
      reqId,
      taskId: input.taskId,
      updates: { name: proposedName },
    });
  }, []);

  const blockedByFloatPathViewReason = "Disabled while Float Path filtered view is active.";
  const canAdd = useMemo(
    () => taskName.trim().length > 0 && workerReady && !isFloatPathFilteredViewActive,
    [taskName, workerReady, isFloatPathFilteredViewActive],
  );
  const canAddSelectionDriven = useMemo(
    () => workerReady && selection?.type === "task" && !isFloatPathFilteredViewActive,
    [workerReady, selection, isFloatPathFilteredViewActive],
  );

  const quickAddContext = useMemo<QuickAddContext>(() => {
    if (!workerReady) return { kind: "invalid", reason: "Worker not ready." };
    if (selection?.type !== "task") return { kind: "invalid", reason: "Select a WBS or activity first." };

    const selectedRow = workerVisibleRows.find((row) => row.id === selection.id);
    if (selectedRow) {
      return selectedRow.isSummary
        ? { kind: "valid", parentId: selectedRow.id, sourceTaskId: selectedRow.id }
        : { kind: "valid", parentId: selectedRow.parentId ?? null, sourceTaskId: selectedRow.id };
    }

    const selectedTask = tasks.find((task) => task.id === selection.id);
    if (!selectedTask) return { kind: "invalid", reason: "Select a WBS or activity first." };
    return { kind: "valid", parentId: selectedTask.parentId ?? null, sourceTaskId: selectedTask.id };
  }, [workerReady, selection, workerVisibleRows, tasks]);

  const canQuickAddActivity = quickAddContext.kind === "valid" && !isFloatPathFilteredViewActive;

  const postAddTask = (parentId?: string, nameOverride?: string) => {
    if (isFloatPathFilteredViewActive) return;
    const name = nameOverride ?? taskName.trim();
    if (!name || !workerRef.current) return;

    const task: Task = {
      id: makeId(),
      name,
      durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
      siblingOrder: "",
      ...(parentId ? { parentId } : {}),
    };

    workerRef.current.postMessage({
      type: "ADD_TASK",
      v: 1,
      reqId: makeId(),
      payload: task
    });

    setTaskName("");
    setSelectedParentId("");
  };

  const handleAdd = () => {
    if (isFloatPathFilteredViewActive) return;
    postAddTask(selectedParentId || undefined);
  };

  const handleAddChild = () => {
    if (isFloatPathFilteredViewActive) return;
    if (selection?.type !== "task") return;
    postAddTask(selection.id, taskName.trim() || "New Task");
  };

  const handleAddSibling = () => {
    if (isFloatPathFilteredViewActive) return;
    if (selection?.type !== "task") return;
    const selectedTask = tasks.find((t) => t.id === selection.id);
    if (!selectedTask) return;
    postAddTask(selectedTask.parentId, taskName.trim() || "New Task");
  };

  const handleQuickAddActivity = () => {
    if (isFloatPathFilteredViewActive) return;
    if (quickAddContext.kind !== "valid") return;
    postAddTask(quickAddContext.parentId ?? undefined, taskName.trim() || "New Task");
  };

  const handleUpdateDuration = useCallback((taskId: string, newDuration: number) => {
    if (!workerRef.current) return;

    workerRef.current.postMessage({
      type: "UPDATE_TASK",
      v: 1,
      reqId: makeId(),
      taskId,
      updates: { durationWorkMinutes: (newDuration * MINUTES_PER_DAY) as WorkMinutes },
    });
  }, []);

  const handleUpdateTask = useCallback((taskId: string, updates: { name?: string; durationWorkMinutes?: WorkMinutes; minEarlyStartMinutes?: WorkMinutes; parentId?: string | null; constraintType?: ConstraintType; constraintDateMinutes?: WorkMinutes | null }) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "UPDATE_TASK",
      v: 1,
      reqId: makeId(),
      taskId,
      updates,
    });
  }, []);

  const handleAddDependency = useCallback((predId: string, succId: string, depType: DependencyType = "FS", lag = 0) => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current) return;

    workerRef.current.postMessage({
      type: "ADD_DEPENDENCY",
      v: 1,
      reqId: makeId(),
      payload: {
        id: makeId(),
        predId,
        succId,
        type: depType,
        lagWorkMinutes: (lag * MINUTES_PER_DAY) as WorkMinutes,
      },
    });
  }, [isFloatPathFilteredViewActive]);

  const handleUpdateDependencyType = useCallback((depId: string, depType: DependencyType) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "UPDATE_DEPENDENCY",
      v: 1,
      reqId: makeId(),
      dependencyId: depId,
      updates: { type: depType },
    });
  }, []);

  const handleUpdateDependencyLag = useCallback((depId: string, lag: number) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "UPDATE_DEPENDENCY",
      v: 1,
      reqId: makeId(),
      dependencyId: depId,
      updates: { lagWorkMinutes: (lag * MINUTES_PER_DAY) as WorkMinutes },
    });
  }, []);

  const handleDeleteTask = useCallback((taskId: string) => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "DELETE_TASK", v: 1, reqId: makeId(), taskId });
  }, [isFloatPathFilteredViewActive]);

  const handleDeleteDependency = useCallback((dependencyId: string) => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "DELETE_DEPENDENCY", v: 1, reqId: makeId(), dependencyId });
  }, [isFloatPathFilteredViewActive]);

  const handleDeleteDependencyFromTaskDetails = useCallback((dependencyId: string) => {
    if (!workerRef.current) return;
    const reqId = makeId();
    if (isFloatPathFilteredViewActive && lastFloatPathRunInputRef.current) {
      autoRefreshFloatPathAfterDependencyMutationRef.current = true;
      pendingFloatPathMutationReqIdRef.current = reqId;
    }
    workerRef.current.postMessage({ type: "DELETE_DEPENDENCY", v: 1, reqId, dependencyId });
  }, [isFloatPathFilteredViewActive]);

  const handleAddResource = useCallback(() => {
    const name = resourceName.trim();
    if (!name || !workerRef.current) return;
    workerRef.current.postMessage({
      type: "ADD_RESOURCE", v: 1, reqId: makeId(),
      payload: { id: makeId(), name, maxUnitsPerDay: 1 },
    });
    setResourceName("");
  }, [resourceName]);

  const handleDeleteResource = useCallback((resourceId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "DELETE_RESOURCE", v: 1, reqId: makeId(), resourceId });
  }, []);

  const handleAddAssignment = useCallback((taskId: string, resourceId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "ADD_ASSIGNMENT", v: 1, reqId: makeId(),
      payload: { id: makeId(), taskId, resourceId, unitsPerDay: 1 },
    });
  }, []);

  const handleDeleteAssignment = useCallback((assignmentId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "DELETE_ASSIGNMENT", v: 1, reqId: makeId(), assignmentId });
  }, []);

  // Auto-select first resource when resources change
  useEffect(() => {
    if (!selectedResourceId && resources.length > 0) {
      setSelectedResourceId(resources[0].id);
    } else if (selectedResourceId && !resources.some(r => r.id === selectedResourceId)) {
      setSelectedResourceId(resources.length > 0 ? resources[0].id : null);
    }
  }, [resources, selectedResourceId]);

  const handleGanttScrollLeftChange = useCallback((sl: number, pw: number) => {
    setGanttScrollLeft(sl);
    setGanttPaneWidth(pw);
  }, []);

  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId) ?? null,
    [resources, selectedResourceId],
  );

  const selectedTask = useMemo(
    () => (selection?.type === "task" ? workerVisibleRows.find((t) => t.id === selection.id) ?? null : null),
    [selection, workerVisibleRows],
  );

  const selectedActivityId = useMemo(
    () => getSelectedActivityId(selectedTask),
    [selectedTask],
  );

  const taskDetailsDependencies = useMemo(
    () => getSelectedTaskDependencies(dependencies, selectedActivityId),
    [dependencies, selectedActivityId],
  );

  const taskDetailsAssignments = useMemo(
    () => getSelectedTaskAssignments(assignments, selectedActivityId),
    [assignments, selectedActivityId],
  );

  const floatPathTaskLookup = useMemo<Record<string, FloatPathTaskDisplay>>(() => {
    const byId: Record<string, FloatPathTaskDisplay> = {};
    const rowById = new Map(workerVisibleRows.map((row) => [row.id, row]));

    for (const task of tasks) {
      const row = rowById.get(task.id);
      const activityId = task.sourceActivityId?.trim() || task.activityCode?.trim() || task.id;
      byId[task.id] = {
        taskId: task.id,
        activityId,
        name: task.name,
        wbsPath: row?.wbsCode,
        isMilestone: (row?.durationWorkMinutes ?? task.durationWorkMinutes) === 0 && !(row?.isSummary ?? false),
        isSummary: row?.isSummary,
        totalFloat: scheduleResults[task.id]?.totalFloatMinutes,
      };
    }

    return byId;
  }, [tasks, workerVisibleRows, scheduleResults]);

  // Driving logic task lookup — activity ID + name for display in DrivingLogicPanel.
  const drivingLogicTaskLookup = useMemo<Record<string, DrivingLogicTaskDisplay>>(() => {
    const byId: Record<string, DrivingLogicTaskDisplay> = {};
    for (const task of tasks) {
      const activityId = task.sourceActivityId?.trim() || task.activityCode?.trim() || task.id;
      byId[task.id] = { taskId: task.id, activityId, name: task.name };
    }
    return byId;
  }, [tasks]);

  const handleSelect = useCallback((sel: Selection) => {
    setSelection(sel);
    if (!sel || sel.type !== "task") setSelectedTaskIds([]);
  }, []);

  const handleRowClick = useCallback((taskId: string, multi: boolean) => {
    setSelection({ type: "task", id: taskId });
    if (multi) {
      setSelectedTaskIds((prev) =>
        prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
      );
    } else {
      setSelectedTaskIds([taskId]);
    }
  }, []);

  const handleGoToRelatedActivity = useCallback((taskId: string) => {
    setSelection({ type: "task", id: taskId });
    setSelectedTaskIds([taskId]);
    setActiveBottomTab("task-details");

    const rowIndex = displayedRows.findIndex((row) => row.id === taskId);
    if (rowIndex < 0) return;

    const track = scrollTrackRef.current;
    if (!track) return;

    const centerOffset = Math.max(0, viewportHeight - rowHeight) / 2;
    const targetTop = Math.max(0, rowIndex * rowHeight - centerOffset);
    track.scrollTop = targetTop;

    const st = track.scrollTop;
    setScrollTop(st);
    if (tableBodyRef.current) tableBodyRef.current.scrollTop = st;
  }, [displayedRows, rowHeight, setActiveBottomTab, viewportHeight]);

  const handleToggleCollapse = useCallback((taskId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "TOGGLE_NODE",
      v: 1,
      reqId: makeId(),
      id: taskId,
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "EXPAND_ALL", v: 1, reqId: makeId() });
  }, []);

  const handleCollapseAll = useCallback(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "COLLAPSE_ALL_NODES", v: 1, reqId: makeId() });
  }, []);

  const handleMoveUp = useCallback(() => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current || !selection || selection.type !== "task") return;
    const task = workerVisibleRows.find(t => t.id === selection.id);
    if (!task) return;

    // Find all siblings (same parentId) within visible rows, including the task itself
    const siblings = workerVisibleRows.filter(t => t.parentId === task.parentId);
    const taskIndex = siblings.findIndex(t => t.id === selection.id);
    
    if (taskIndex <= 0) return; // Already first, can't move up

    // Move to position before current: place after the sibling that will be before us
    workerRef.current.postMessage({
      type: "REORDER_TASK",
      v: 1,
      reqId: makeId(),
      taskId: selection.id,
      afterTaskId: taskIndex > 1 ? siblings[taskIndex - 2].id : undefined,
    });
  }, [selection, workerVisibleRows, workerRef, isFloatPathFilteredViewActive]);

  const handleMoveDown = useCallback(() => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current || !selection || selection.type !== "task") return;
    const task = workerVisibleRows.find(t => t.id === selection.id);
    if (!task) return;

    // Find all siblings (same parentId) within visible rows, including the task itself
    const siblings = workerVisibleRows.filter(t => t.parentId === task.parentId);
    const taskIndex = siblings.findIndex(t => t.id === selection.id);
    
    if (taskIndex >= siblings.length - 1) return; // Already last, can't move down

    // Move to position after current: place after the next sibling
    const nextSibling = siblings[taskIndex + 1];
    workerRef.current.postMessage({
      type: "REORDER_TASK",
      v: 1,
      reqId: makeId(),
      taskId: selection.id,
      afterTaskId: nextSibling.id,
    });
  }, [selection, workerVisibleRows, workerRef, isFloatPathFilteredViewActive]);

  const handleIndentRight = useCallback(() => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current || !selection || selection.type !== "task") return;
    workerRef.current.postMessage({
      type: "INDENT_TASK",
      v: 1,
      reqId: makeId(),
      taskId: selection.id,
    });
  }, [selection, workerRef, isFloatPathFilteredViewActive]);

  const handleIndentLeft = useCallback(() => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current || !selection || selection.type !== "task") return;
    workerRef.current.postMessage({
      type: "OUTDENT_TASK",
      v: 1,
      reqId: makeId(),
      taskId: selection.id,
    });
  }, [selection, workerRef, isFloatPathFilteredViewActive]);

  // Keyboard: Delete / Backspace dispatches delete for the selected entity
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selection) return;
      e.preventDefault();
      if (selection.type === "task") handleDeleteTask(selection.id);
      if (selection.type === "dependency") handleDeleteDependency(selection.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, handleDeleteTask, handleDeleteDependency]);

  const canLink = useMemo(
    () => workerReady && selectedTaskIds.length === 2 && !isFloatPathFilteredViewActive,
    [workerReady, selectedTaskIds, isFloatPathFilteredViewActive],
  );

  const handleLink = () => {
    if (isFloatPathFilteredViewActive) return;
    if (!workerRef.current || selectedTaskIds.length !== 2) return;

    const [predId, succId] = selectedTaskIds;

    const dep: Dependency = {
      id: makeId(),
      predId,
      succId,
      type: "FS",
      lagWorkMinutes: 0 as WorkMinutes,
    };

    workerRef.current.postMessage({
      type: "ADD_DEPENDENCY",
      v: 1,
      reqId: makeId(),
      payload: dep
    });
  };

  const getTaskName = (id: string): string => {
    return tasks.find(t => t.id === id)?.name || id;
  };

  return (
    <WorkspaceContainer>
      <MainWorkspace>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, fontFamily: "Arial, sans-serif" }}>
          {/* ── Toolbar ────────────────────────────────────────────────── */}
          <div className="toolbar planner-toolbar planner-commandbar">
            <div ref={menubarRef} className="planner-menubar" role="menubar" aria-label="Planner menu bar">
              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "file"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("file"); }}>File</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-commands">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xer,.xml"
                    style={{ display: "none" }}
                    onChange={handleImportFileSelect}
                  />
                  <button onClick={() => fileInputRef.current?.click()} disabled={!workerReady} className="toolbar-btn toolbar-btn-quiet toolbar-menu-item">
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⇩</span>
                    <span className="toolbar-menu-item-label">Import…</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "edit"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("edit"); }}>Edit</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-commands">
                  <button
                    onClick={() => workerRef.current?.postMessage({ type: "UNDO", v: 1, reqId: makeId() })}
                    disabled={!canUndo}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">↶</span>
                    <span className="toolbar-menu-item-label">Undo</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => workerRef.current?.postMessage({ type: "REDO", v: 1, reqId: makeId() })}
                    disabled={!canRedo}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">↷</span>
                    <span className="toolbar-menu-item-label">Redo</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => {
                      if (selection?.type === "task") handleDeleteTask(selection.id);
                      else if (selection?.type === "dependency") handleDeleteDependency(selection.id);
                    }}
                    disabled={!selection || isFloatPathFilteredViewActive}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-danger toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">🗑</span>
                    <span className="toolbar-menu-item-label">Delete</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true">Del</span>
                  </button>
                  <button
                    onClick={handleLink}
                    disabled={!canLink}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">🔗</span>
                    <span className="toolbar-menu-item-label">Link</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "view"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("view"); }}>View</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-controls">
                  <button
                    data-testid="open-calendar-settings"
                    onClick={() => setIsCalendarSettingsOpen(true)}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">🗓</span>
                    <span className="toolbar-menu-item-label">Calendar Settings</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => isBottomOpen && activeBottomTab === "histogram" ? toggleBottomDrawer(false) : setActiveBottomTab("histogram")}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">▥</span>
                    <span className="toolbar-menu-item-label">Histogram</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => isBottomOpen && activeBottomTab === "logs" ? toggleBottomDrawer(false) : setActiveBottomTab("logs")}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">≡</span>
                    <span className="toolbar-menu-item-label">Logs</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => isBottomOpen && activeBottomTab === "float-path" ? toggleBottomDrawer(false) : setActiveBottomTab("float-path")}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⇢</span>
                    <span className="toolbar-menu-item-label">Float Paths</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  {sourceImportRecord && (
                    <button
                      data-testid="open-import-details"
                      onClick={() => setIsImportDetailsOpen(true)}
                      className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                    >
                      <span className="toolbar-menu-item-icon" aria-hidden="true">⌘</span>
                      <span className="toolbar-menu-item-label">Import Details</span>
                      <span className="toolbar-menu-item-hint" aria-hidden="true" />
                    </button>
                  )}
                  {sourceImportRecord && sourceCalculatedVarianceReport && (
                    <button
                      data-testid="open-source-planner-report"
                      onClick={() => setIsSourcePlannerReportOpen(true)}
                      className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                    >
                      <span className="toolbar-menu-item-icon" aria-hidden="true">▤</span>
                      <span className="toolbar-menu-item-label">View Source vs Planner Report</span>
                      <span className="toolbar-menu-item-hint" aria-hidden="true" />
                    </button>
                  )}
                  <label className="toolbar-menu-field toolbar-menu-control-row">
                    <span className="toolbar-menu-control-icon" aria-hidden="true">⛃</span>
                    <span className="toolbar-menu-control-label">Constraint</span>
                    <select
                      value={constraintFilter}
                      onChange={(e) => setConstraintFilter(e.target.value as ConstraintFilter)}
                      className="toolbar-select toolbar-menu-control-input"
                    >
                      <option value="all">All</option>
                      <option value="constrained">Constrained</option>
                      <option value="unconstrained">Unconstrained</option>
                      <option value="SNET">SNET</option>
                      <option value="FNLT">FNLT</option>
                      <option value="MSO">MSO</option>
                      <option value="MFO">MFO</option>
                      <option value="ALAP">ALAP</option>
                    </select>
                  </label>
                  <label className="toolbar-menu-field toolbar-menu-control-row">
                    <span className="toolbar-menu-control-icon" aria-hidden="true">📅</span>
                    <span className="toolbar-menu-control-label">Timescale</span>
                    <select
                      value={timescaleProfileId}
                      onChange={(e) => setTimescaleProfileId(e.target.value as TimescaleProfileId)}
                      className="toolbar-select toolbar-menu-control-input"
                      title="Fixed timescale profile"
                    >
                      {visibleTimescaleProfiles.map((profileId) => {
                        const profile = TIMESCALE_PROFILES[profileId];
                        return (
                          <option key={profileId} value={profileId}>
                            {profile.label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="toolbar-menu-field toolbar-menu-control-row">
                    <span className="toolbar-menu-control-icon" aria-hidden="true">🗓</span>
                    <span className="toolbar-menu-control-label">Date Format</span>
                    <select
                      value={dateDisplayFormat}
                      onChange={(e) => setDateDisplayFormat(e.target.value as DateDisplayFormat)}
                      className="toolbar-select toolbar-menu-control-input"
                      title="Date display format for all task table date columns"
                    >
                      {DATE_DISPLAY_FORMAT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} title={opt.example}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="toolbar-menu-field toolbar-menu-control-row">
                    <span className="toolbar-menu-control-icon" aria-hidden="true">👥</span>
                    <span className="toolbar-menu-control-label">Resource</span>
                    <select
                      value={selectedResourceId ?? ""}
                      onChange={(e) => setSelectedResourceId(e.target.value || null)}
                      className="toolbar-select toolbar-menu-control-input"
                      disabled={resources.length === 0}
                      title={resources.length === 0 ? "No resources available" : "Selected resource"}
                    >
                      {resources.length === 0 ? (
                        <option value="">(none)</option>
                      ) : (
                        resources.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))
                      )}
                    </select>
                    </label>
                    <div className="toolbar-menu-field toolbar-menu-control-row toolbar-menu-columns-row">
                      <span className="toolbar-menu-control-icon" aria-hidden="true">⚙</span>
                      <span className="toolbar-menu-control-label">Columns</span>
                      <div className="toolbar-menu-columns-list" role="group" aria-label="Visible task table columns">
                        {TASK_COLUMN_REGISTRY.filter((c) => c.id !== "wbs" && c.id !== "id").map((c) => (
                          <label key={c.id} className="toolbar-menu-column-option">
                            <input
                              type="checkbox"
                              checked={!hiddenTaskColumns.has(c.id)}
                              onChange={() => toggleTaskColumnVisibility(c.id)}
                            />
                            <span>{c.title ?? c.label}</span>
                          </label>
                        ))}
                    </div>
                    </div>
                </div>
              </details>

              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "insert"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("insert"); }}>Insert</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-controls">
                  <label className="toolbar-menu-field toolbar-menu-control-row">
                    <span className="toolbar-menu-control-icon" aria-hidden="true">＋</span>
                    <span className="toolbar-menu-control-label">Task name</span>
                    <input
                      value={taskName}
                      onChange={(e) => setTaskName(e.target.value)}
                      placeholder="Task name"
                      className="toolbar-input toolbar-menu-control-input"
                    />
                  </label>
                  <label className="toolbar-menu-field toolbar-menu-control-row">
                    <span className="toolbar-menu-control-icon" aria-hidden="true">⊏</span>
                    <span className="toolbar-menu-control-label">Parent</span>
                    <select
                      value={selectedParentId}
                      onChange={(e) => setSelectedParentId(e.target.value)}
                      className="toolbar-select toolbar-select-parent toolbar-menu-control-input"
                    >
                      <option value="">(root)</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={handleAdd}
                    disabled={!canAdd}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-primary toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">＋</span>
                    <span className="toolbar-menu-item-label">Add Task</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleAddChild}
                    disabled={!canAddSelectionDriven}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⊕</span>
                    <span className="toolbar-menu-item-label">Add Child</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleAddSibling}
                    disabled={!canAddSelectionDriven}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">↔</span>
                    <span className="toolbar-menu-item-label">Add Sibling</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "structure"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("structure"); }}>Structure</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-commands">
                  <button onClick={handleExpandAll} disabled={!workerReady} className="toolbar-btn toolbar-btn-quiet toolbar-menu-item">
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⊞</span>
                    <span className="toolbar-menu-item-label">Expand All</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button onClick={handleCollapseAll} disabled={!workerReady} className="toolbar-btn toolbar-btn-quiet toolbar-menu-item">
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⊟</span>
                    <span className="toolbar-menu-item-label">Collapse All</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleMoveUp}
                    disabled={!selection || selection.type !== "task" || isFloatPathFilteredViewActive}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">↑</span>
                    <span className="toolbar-menu-item-label">Move Up</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleMoveDown}
                    disabled={!selection || selection.type !== "task" || isFloatPathFilteredViewActive}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">↓</span>
                    <span className="toolbar-menu-item-label">Move Down</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleIndentRight}
                    disabled={!selection || selection.type !== "task" || isFloatPathFilteredViewActive}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">&gt;</span>
                    <span className="toolbar-menu-item-label">Indent Right</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleIndentLeft}
                    disabled={!selection || selection.type !== "task" || isFloatPathFilteredViewActive}
                    title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : undefined}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">&lt;</span>
                    <span className="toolbar-menu-item-label">Indent Left</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "baseline"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("baseline"); }}>Baseline</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-commands">
                  <button
                    onClick={() => workerRef.current?.postMessage({ type: "SNAPSHOT_BASELINE", v: 1, reqId: makeId() })}
                    disabled={!workerReady || Object.keys(scheduleResults).length === 0}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⚑</span>
                    <span className="toolbar-menu-item-label">Set Baseline</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => workerRef.current?.postMessage({ type: "CLEAR_BASELINE", v: 1, reqId: makeId() })}
                    disabled={!workerReady || Object.keys(baselines).length === 0}
                    className="toolbar-btn toolbar-btn-quiet toolbar-menu-item"
                  >
                    <span className="toolbar-menu-item-icon" aria-hidden="true">⌧</span>
                    <span className="toolbar-menu-item-label">Clear Baseline</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                </div>
              </details>

              <details className="toolbar-menu toolbar-menu-menubar" open={activeMenu === "help"}>
                <summary className="toolbar-menu-title" onClick={(e) => { e.preventDefault(); toggleMenu("help"); }}>Help</summary>
                <div className="toolbar-menu-panel toolbar-menu-panel-commands">
                  <button className="toolbar-btn toolbar-btn-quiet toolbar-menu-item" disabled>
                    <span className="toolbar-menu-item-icon" aria-hidden="true">?</span>
                    <span className="toolbar-menu-item-label">Help is not configured</span>
                    <span className="toolbar-menu-item-hint" aria-hidden="true" />
                  </button>
                </div>
              </details>
            </div>
          </div>

          {scheduleLifecycle === "sourceImportedNotCalculated" && (
            <div
              style={{
                margin: "8px 0",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #d68f27",
                background: "#fff7eb",
                color: "#7a4e00",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>Source import committed from {sourceImportRecord?.sourceFileName ?? "(unknown file)"}. Planner-Studio has not been explicitly recalculated yet.</span>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <button
                  onClick={handleRunRecalculation}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 5,
                    border: "1px solid #d68f27",
                    background: "#fff",
                    color: "#7a4e00",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Run Planner Recalculation
                </button>
                {classifyCalendarRisk(
                  sourceImportRecord?.summary.calendarFidelity,
                  sourceImportRecord?.diagnostics ?? [],
                ).level === "high" && (
                  <span style={{ fontSize: 11, color: "#8d3f00", maxWidth: 360, textAlign: "right" }}>
                    High calendar-risk import: Planner recalculated dates may differ significantly from P6 source dates.
                  </span>
                )}
              </div>
            </div>
          )}

          {scheduleLifecycle === "plannerCalculatedWithVariance" && sourceCalculatedVarianceReport && (
            <div
              data-testid="variance-report-panel"
              style={{
                margin: "8px 0",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #7b61b5",
                background: "#f6f2ff",
                color: "#3b1f6e",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                Source vs Planner-Calculated Variance Report
              </div>
              <div style={{ fontSize: 12, color: "#5b4080", marginBottom: 8 }}>
                Imported Source Dates are preserved. Planner-Calculated Dates are a separate interpretation.
              </div>
              {sourceImportRecord?.sourceProjectSettings?.defaultCalendarId && (
                <div style={{ fontSize: 12, color: "#5b4080", marginBottom: 8 }}>
                  Project default calendar is active. Activity calendar assignments are compiled but remain inactive in the scheduling engine.
                </div>
              )}
              <div style={{ fontSize: 12, color: "#5b4080", marginBottom: 8 }} data-testid="temporal-shadow-status-note">
                Temporal calendar-aware shadow calculation is available. Authority remains slot engine.
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                <span data-testid="variance-total-compared">Compared: <strong>{sourceCalculatedVarianceReport.totalCompared}</strong></span>
                <span data-testid="variance-no-variance-count">No variance: <strong>{sourceCalculatedVarianceReport.noVarianceCount}</strong></span>
                <span data-testid="variance-start-variance-count">Start differences: <strong>{sourceCalculatedVarianceReport.startVarianceCount}</strong></span>
                <span data-testid="variance-finish-variance-count">Finish differences: <strong>{sourceCalculatedVarianceReport.finishVarianceCount}</strong></span>
                {sourceCalculatedVarianceReport.majorVarianceCount > 0 && (
                  <span data-testid="variance-major-count" style={{ color: "#c0392b", fontWeight: 600 }}>
                    Major variances (&gt;5 days): {sourceCalculatedVarianceReport.majorVarianceCount}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  data-testid="open-source-planner-report-from-variance"
                  onClick={() => setIsSourcePlannerReportOpen(true)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "1px solid #7b61b5",
                    background: "#fff",
                    color: "#4b2f82",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  View Source vs Planner Report
                </button>
              </div>
              {sourceCalculatedVarianceReport.taskVariances.slice(0, 5).some(v => v.varianceSeverity !== "none") && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "#5b4080" }}>Top tasks with variance</summary>
                  <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 12 }}>
                    {sourceCalculatedVarianceReport.taskVariances.filter(v => v.varianceSeverity !== "none").slice(0, 5).map(v => (
                      <li key={v.taskId} style={{ marginBottom: 4 }}>
                        <strong>{v.taskName}</strong>
                        {v.finishVarianceMinutes !== undefined && v.finishVarianceMinutes !== 0 && (
                          <span style={{ marginLeft: 4 }}>
                            Finish {v.finishVarianceMinutes > 0 ? "+" : ""}{Math.round(v.finishVarianceMinutes / 480 * 10) / 10}d
                          </span>
                        )}
                        {v.varianceSeverity === "major" && <span style={{ marginLeft: 4, color: "#c0392b" }}>(major)</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Main content: table + gantt + shared vertical scroll track */}
          <div ref={mainContentRowRef} style={{ display: "flex", flex: 1, overflow: "hidden" }} onWheel={handleWheel}>
            {/* Left upper pane — fixed width from tableWidth, full height */}
            <div ref={tableContainerRef} style={{ width: tableWidth, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%" }}>
            <TaskTable
              tasks={displayedRows}
              scheduleResults={scheduleResults}
              variances={variances}
              diagnosticsMap={diagnosticsMap}
              onUpdateTask={handleUpdateTask}
              scrollTop={scrollTop}
              viewportHeight={viewportHeight}
              projectStartDate={projectStartDate}
              selectedTaskId={selection?.type === "task" ? selection.id : null}
              selectedTaskIds={selectedTaskIds}
              onSelectTask={(id, multi) => handleRowClick(id, multi)}
              onToggleCollapse={handleToggleCollapse}
              bodyRef={tableBodyRef}
              hiddenColumnIds={hiddenTaskColumns}
              onContextMenu={handleOpenContextMenu}
              sourceImportFidelityState={sourceImportFidelityState}
              dateDisplayFormat={dateDisplayFormat}
            />
            </div>
            <WorkspaceSplitter tableRef={tableContainerRef} containerRef={mainContentRowRef} lowerAxisRef={histogramAxisRef} />
            {/* Right pane: Gantt only (histogram moved to BottomDrawer) */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
              <GanttPane
                tasks={displayedRows}
                scheduleResults={scheduleResults}
                dependencies={dependencies}
                scrollTop={scrollTop}
                viewportHeight={viewportHeight}
                onUpdateDuration={handleUpdateDuration}
                onUpdateTask={handleUpdateTask}
                onAddDependency={handleAddDependency}
                vScrollRef={scrollTrackRef}
                timeline={timeline}
                selection={selection}
                onSelect={handleSelect}
                nonWorkingDays={nonWorkingDays}
                baselines={baselines}
                timescaleProfileId={timescaleProfileId}
                  manualPixelsPerDayOverride={manualPixelsPerDayOverride}
                  onManualPixelsPerDayOverrideChange={setManualPixelsPerDayOverride}
                showDependencies={showDependencies}
                onScrollLeftChange={handleGanttScrollLeftChange}
                onHScrollMount={handleGanttHScrollMount}
                bodyRef={ganttBodyRef}
              />
            </div>

            <div className="planner-action-rail" aria-label="Action toolbox">
              <div className="planner-action-group">
                <button
                    type="button"
                  onClick={handleQuickAddActivity}
                  disabled={!canQuickAddActivity}
                  className="toolbar-btn toolbar-btn-primary toolbar-btn-icon planner-action-btn"
                  title={
                    isFloatPathFilteredViewActive
                      ? blockedByFloatPathViewReason
                      : canQuickAddActivity
                        ? "Add Activity"
                        : quickAddContext.kind === "invalid"
                          ? quickAddContext.reason
                          : "Add Activity"
                  }
                  aria-label="Add Activity"
                >
                  ＋
                </button>
                <button
                    type="button"
                  onClick={handleAddChild}
                  disabled={!canAddSelectionDriven}
                  className="toolbar-btn toolbar-btn-quiet toolbar-btn-icon planner-action-btn"
                  title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : "Add Child"}
                  aria-label="Add Child"
                >
                  ⊕
                </button>
              </div>

              <div className="planner-action-group">
                <button
                    type="button"
                  onClick={() => {
                    if (selection?.type === "task") handleDeleteTask(selection.id);
                    else if (selection?.type === "dependency") handleDeleteDependency(selection.id);
                  }}
                  disabled={!selection || isFloatPathFilteredViewActive}
                  className="toolbar-btn toolbar-btn-danger toolbar-btn-icon planner-action-btn"
                  title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : "Delete"}
                  aria-label="Delete"
                >
                  🗑
                </button>
                <button
                    type="button"
                  onClick={handleLink}
                  disabled={!canLink}
                  className="toolbar-btn toolbar-btn-quiet toolbar-btn-icon planner-action-btn"
                  title={isFloatPathFilteredViewActive ? blockedByFloatPathViewReason : "Link"}
                  aria-label="Link"
                >
                  🔗
                </button>
                <button
                    type="button"
                  onClick={() => setShowDependencies((prev) => !prev)}
                  className={`toolbar-btn ${showDependencies ? "toolbar-btn-primary" : "toolbar-btn-quiet"} toolbar-btn-icon planner-action-btn`}
                  title={showDependencies ? "Hide Dependencies" : "Show Dependencies"}
                  aria-label={showDependencies ? "Hide Dependencies" : "Show Dependencies"}
                  aria-pressed={showDependencies}
                >
                  ⇄
                </button>
              </div>

              <div className="planner-action-group">
                <button
                    type="button"
                  onClick={() => workerRef.current?.postMessage({ type: "UNDO", v: 1, reqId: makeId() })}
                  disabled={!canUndo}
                  className="toolbar-btn toolbar-btn-quiet toolbar-btn-icon planner-action-btn"
                  title="Undo"
                  aria-label="Undo"
                >
                  ↶
                </button>
                <button
                    type="button"
                  onClick={() => workerRef.current?.postMessage({ type: "REDO", v: 1, reqId: makeId() })}
                  disabled={!canRedo}
                  className="toolbar-btn toolbar-btn-quiet toolbar-btn-icon planner-action-btn"
                  title="Redo"
                  aria-label="Redo"
                >
                  ↷
                </button>
              </div>
            </div>

            {/* Shared vertical scroll track — single owner of vertical scrollTop */}
            <div
              ref={scrollTrackRef}
              onScroll={handleScrollTrack}
              style={{
                width: 17,
                overflowY: "auto",
                overflowX: "hidden",
                flexShrink: 0,
                marginTop: HEADER_METRICS.totalHeight,
              }}
            >
              <div style={{ width: 1, height: phantomHeight }} />
            </div>
          </div>


        </div>
      </MainWorkspace>

      {/* Bottom drawer — push layout, sibling of MainWorkspace */}
      {isBottomOpen && (
        <BottomDrawer>
          {activeBottomTab === 'task-details' ? (
            <TaskDetailsPanel
              dependencies={taskDetailsDependencies}
              tasks={tasks}
              getTaskName={getTaskName}
              onUpdateDependencyType={handleUpdateDependencyType}
              onUpdateDependencyLag={handleUpdateDependencyLag}
              onAddDependency={handleAddDependency}
              resources={resources}
              assignments={taskDetailsAssignments}
              resourceName={resourceName}
              onResourceNameChange={setResourceName}
              onAddResource={handleAddResource}
              onDeleteResource={handleDeleteResource}
              onAddAssignment={handleAddAssignment}
              onDeleteAssignment={handleDeleteAssignment}
              selectedTask={selectedTask}
              onUpdateTask={handleUpdateTask}
              diagnosticsMap={diagnosticsMap}
              scheduleResults={scheduleResults}
              projectStartDate={projectStartDate}
              onGoToTask={handleGoToRelatedActivity}
              onDeleteDependency={handleDeleteDependencyFromTaskDetails}
              canDeleteRelationships={true}
              relationshipDeleteDisabledReason={blockedByFloatPathViewReason}
              dependencyDiagnosticsMap={dependencyDiagnosticsMap}
            />
          ) : activeBottomTab === 'float-path' ? (
            <FloatPathPanel
              workerReady={workerReady}
              selectedTask={selectedTask}
              isRunning={floatPathRunning}
              isStale={floatPathStale}
              result={floatPathResult}
              error={floatPathError}
              onRun={handleRunFloatPathAnalysis}
              taskLookup={floatPathTaskLookup}
              viewFilter={floatPathViewFilter}
              layoutMode={floatPathLayoutMode}
              onViewFilterChange={setFloatPathViewFilter}
              onLayoutModeChange={setFloatPathLayoutMode}
              wbsContextDepth={floatPathWbsContextDepth}
              onWbsContextDepthChange={setFloatPathWbsContextDepth}
              projectionActive={isFloatPathFilteredViewActive}
              projectionWarning={floatPathProjectionWarning}
            />
          ) : activeBottomTab === 'driving-logic' ? (
            drivingLogicResult ? (
              <DrivingLogicPanel
                result={drivingLogicResult}
                taskLookup={drivingLogicTaskLookup}
                onClear={handleClearDrivingLogic}
              />
            ) : (
              <div style={{ padding: 12, fontFamily: "Arial, sans-serif", fontSize: 13, color: "var(--text-muted, #666)" }}>
                Right-click an activity and choose &ldquo;Show Driving Logic&rdquo; to trace its immediate driving predecessors and successors.
              </div>
            )
          ) : activeBottomTab === 'logs' ? (
            <div style={{ padding: 12, overflow: "auto", height: "100%", fontFamily: "Arial, sans-serif" }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "1em" }}>Worker Logs</h3>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: "0.9em" }}>
                {logs.slice(0, 50).map((log, i) => (
                  <li key={`${log}-${i}`} style={{ fontFamily: "monospace", fontSize: "0.85em" }}>
                    {log}
                  </li>
                ))}
              </ul>
            </div>
          ) : activeBottomTab === 'ai-review' ? (
            <AIReviewPanel
              snapshot={aiSnapshot}
              onApplyRenameProposal={handleApplyAiRename}
              renameApplyByProposalId={aiRenameApplyByProposalId}
            />
          ) : activeBottomTab === 'dashboard' ? (
            <ScheduleDashboard snapshot={aiSnapshot} />
          ) : (
            <HistogramPane
              resourceHistogram={resourceHistogram}
              selectedResource={selectedResource}
              ganttScrollElRef={ganttScrollElRef}
              timeline={timeline}
              tableWidth={tableWidth}
              nonWorkingDays={nonWorkingDays}
              axisPaneRef={histogramAxisRef}
            />
          )}
        </BottomDrawer>
      )}
      {/* Import details overlay (W4.5 read-only verification view) */}
      {isImportDetailsOpen && importDetailsViewModel && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.44)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
          }}
          onClick={() => setIsImportDetailsOpen(false)}
        >
          <ImportDetailsPanel
            viewModel={importDetailsViewModel}
            onClose={() => setIsImportDetailsOpen(false)}
          />
        </div>
      )}
      {isSourcePlannerReportOpen && sourcePlannerReportViewModel && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.44)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1003,
          }}
          onClick={() => setIsSourcePlannerReportOpen(false)}
        >
          <SourcePlannerRecalculationReportPanel
            viewModel={sourcePlannerReportViewModel}
            onClose={() => setIsSourcePlannerReportOpen(false)}
          />
        </div>
      )}
      {isCalendarSettingsOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.44)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1002,
          }}
          onClick={() => setIsCalendarSettingsOpen(false)}
        >
          <CalendarSettingsPanel
            plannerCalendars={plannerCalendars}
            sourceImportRecord={sourceImportRecord}
            tasks={tasks}
            selectedTaskIds={selectedTaskIds}
            projectDefaultCalendarId={projectDefaultCalendarId}
            onClose={() => setIsCalendarSettingsOpen(false)}
            onSavePlannerCalendar={handleSavePlannerCalendar}
            onCloneImportedCalendar={handleCloneImportedCalendar}
            onSetProjectDefault={handleSetProjectDefaultCalendar}
            onAssignCalendarToActivities={handleAssignCalendarToActivities}
          />
        </div>
      )}
      {/* Import preview overlay */}
      {importPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={handleImportCancel}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ImportPreviewPanel data={importPreview} onImport={handleImportCommit} onCancel={handleImportCancel} />
          </div>
        </div>
      )}
      {/* Activity right-click context menu (TD-TRACE.2A/2B) */}
      {contextMenu && (
        <TaskContextMenu
          taskId={contextMenu.taskId}
          isSummary={contextMenu.isSummary}
          hasScheduleResult={contextMenu.hasScheduleResult}
          hasDrivingDiagnostics={Object.keys(dependencyDiagnosticsMap).length > 0}
          position={contextMenu.position}
          onAction={handleContextMenuAction}
          onClose={handleCloseContextMenu}
        />
      )}
    </WorkspaceContainer>
  );
}