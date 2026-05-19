import type { Assignment, BaselineMap, Dependency, DependencyType, DiagnosticsMap, ImportFormat, Resource, ResourceHistogram, ScheduleResultMap, Task, VarianceMap, WorkerMessage } from "protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GanttPane } from "./components/gantt/GanttPane";
import { HistogramPane } from "./components/HistogramPane";
import type { ImportPreviewData } from "./components/ImportPreviewPanel";
import { TaskDetailsPanel } from "./components/TaskDetailsPanel";
import { TaskTable } from "./components/TaskTable";
import { BottomDiagnosticsDrawer } from "./ui/panels/BottomDiagnosticsDrawer";
import { InspectorPanel } from "./ui/panels/InspectorPanel";
import { AppShell } from "./ui/shell/AppShell";
import { CommandToolbar } from "./ui/shell/CommandToolbar";
import { MenuBar } from "./ui/shell/MenuBar";
import { ProjectStatusStrip } from "./ui/shell/ProjectStatusStrip";
import { deriveWorkspaceShellView, deriveImportStatus, type ImportStatus } from "./ui/state/uiViewState";
import { MainWorkspace } from "./ui/components/shell/MainWorkspace";
import { WorkspaceContainer } from "./ui/components/shell/WorkspaceContainer";
import { WorkspaceSplitter } from "./ui/components/WorkspaceSplitter";
import { HEADER_METRICS } from "./ui/config/themeConfig";
import { useDensityMetrics, useUIStore } from "./ui/store/uiStore";
import { EmptyWorkspace } from "./ui/workspace/EmptyWorkspace";
import { ProgrammePreviewPanel } from "./ui/workspace/ProgrammePreviewPanel";
import { ScheduleWorkspace } from "./ui/workspace/ScheduleWorkspace";
import { WorkspaceLayout } from "./ui/workspace/WorkspaceLayout";
import { filterByConstraint } from "./utils/filterByConstraint";
import { getVisibleTasks } from "./utils/getVisibleTasks";
import { computeTimelineGeometry } from "./utils/timelineGeometry";

export type Selection = { type: "task"; id: string } | { type: "dependency"; id: string } | null;

function makeId() {
  return crypto.randomUUID();
}

export default function App() {
  const { rowHeight } = useDensityMetrics();
  const isBottomOpen = useUIStore((s) => s.isBottomOpen);
  const activeBottomTab = useUIStore((s) => s.activeBottomTab);
  const toggleBottomDrawer = useUIStore((s) => s.toggleBottomDrawer);
  const setStatusText = useUIStore((s) => s.setStatusText);
  const constraintFilter = useUIStore((s) => s.constraintFilter);
  const setConstraintFilter = useUIStore((s) => s.setConstraintFilter);
  const tableWidth = useUIStore((s) => s.tableWidth);
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
  const scrollTrackRef = useRef<HTMLDivElement | null>(null);
  // Re-run measurement when the scroll track actually attaches to the DOM.
  // The scroll track is only mounted while workspaceShellView === "loaded",
  // so a callback ref is required — a one-shot useEffect with [] deps would
  // run before the element exists and never re-run after import commit.
  const [scrollTrackEl, setScrollTrackEl] = useState<HTMLDivElement | null>(null);
  const handleScrollTrackRef = useCallback((el: HTMLDivElement | null) => {
    scrollTrackRef.current = el;
    setScrollTrackEl(el);
  }, []);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
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
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [isInspectorOpen, setInspectorOpen] = useState(false);
  const ganttScrollElRef = useRef<HTMLDivElement | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        payload: { format, content: reader.result },
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

  // Shared timeline geometry — single owner for both Gantt and Histogram
  const timeline = useMemo(
    () => computeTimelineGeometry(scheduleResults, projectStartDate),
    [scheduleResults, projectStartDate],
  );

  const visibleTasks = useMemo(
    () => filterByConstraint(getVisibleTasks(tasks, collapsedIds), constraintFilter),
    [tasks, collapsedIds, constraintFilter],
  );

  // Temporary diagnostic: measure header/body box metrics
  useEffect(() => {
    const leftHeader = document.querySelector(".task-table-header")?.getBoundingClientRect();
    const rightHeader = document.querySelector(".gantt-header")?.getBoundingClientRect();
    const leftBody = document.querySelector(".task-table-body")?.getBoundingClientRect();
    const rightBody = document.querySelector(".gantt-body")?.getBoundingClientRect();
    const firstRow = document.querySelector(".task-table-body tr")?.getBoundingClientRect();

    console.log("[AUDIT header/body alignment]", {
      leftHeaderHeight: leftHeader?.height,
      rightHeaderHeight: rightHeader?.height,
      leftBodyTop: leftBody?.top,
      rightBodyTop: rightBody?.top,
      firstRowHeight: firstRow?.height,
      bodyTopDelta: leftBody && rightBody ? leftBody.top - rightBody.top : null,
    });
  }, []);

  const phantomHeight = visibleTasks.length * rowHeight;

  // Push status text into TopBar via store
  useEffect(() => {
    setStatusText(
      `Tasks: ${tasks.length} | Deps: ${dependencies.length} | Scheduled: ${Object.keys(scheduleResults).length} | Worker: ${workerReady ? 'Ready' : 'Starting...'}`
    );
  }, [tasks.length, dependencies.length, scheduleResults, workerReady, setStatusText]);

  // Clamp scroll after collapse/expand to avoid blank space
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
    // Imperatively sync both upper-pane body containers
    if (tableBodyRef.current) tableBodyRef.current.scrollTop = st;
    if (ganttBodyRef.current) ganttBodyRef.current.scrollTop = st;
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
  // Depends on `scrollTrackEl` (set via callback ref) so the observer attaches
  // both on initial mount AND when the scroll track first appears after the
  // workspace transitions from "empty"/"preview" to "loaded" post-import.
  useEffect(() => {
    const el = scrollTrackEl;
    if (!el) {
      setViewportHeight(0);
      return;
    }

    const measure = () => setViewportHeight(el.clientHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollTrackEl]);

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
      }

      if (msg.type === "NACK") {
        setLogs((prev) => [`NACK ${msg.reqId}: ${msg.error}`, ...prev]);
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
        // Purge selection if the selected entity no longer exists
        setSelection((prev) => {
          if (!prev) return null;
          if (prev.type === "task" && !msg.payload.tasks.some(t => t.id === prev.id)) return null;
          if (prev.type === "dependency" && !msg.payload.dependencies.some(d => d.id === prev.id)) return null;
          return prev;
        });
        setLogs((prev) => [
          `DIFF_STATE tasks=${msg.payload.tasks.length} deps=${msg.payload.dependencies.length} scheduled=${Object.keys(msg.payload.scheduleResults).length}`,
          ...prev
        ]);
      }

      if (msg.type === "IMPORT_PREVIEW") {
        setImportPreview(msg.payload);
        setLogs((prev) => [
          `IMPORT_PREVIEW project="${msg.payload.projectName}" tasks=${msg.payload.summary.taskCount} canCommit=${msg.payload.canCommit}`,
          ...prev,
        ]);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const canAdd = useMemo(() => taskName.trim().length > 0 && workerReady, [taskName, workerReady]);

  const handleAdd = () => {
    const name = taskName.trim();
    if (!name || !workerRef.current) return;

    const task: Task = {
      id: makeId(),
      name,
      duration: 5,
      depth: 0,
      isSummary: false,
      ...(selectedParentId ? { parentId: selectedParentId } : {}),
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

  const handleUpdateDuration = useCallback((taskId: string, newDuration: number) => {
    if (!workerRef.current) return;

    workerRef.current.postMessage({
      type: "UPDATE_TASK",
      v: 1,
      reqId: makeId(),
      taskId,
      updates: { duration: newDuration },
    });
  }, []);

  const handleUpdateTask = useCallback((taskId: string, updates: { name?: string; duration?: number; minEarlyStart?: number; parentId?: string | null; constraintType?: string; constraintDate?: number | null }) => {
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
        lag,
      },
    });
  }, []);

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
      updates: { lag },
    });
  }, []);

  const handleDeleteTask = useCallback((taskId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "DELETE_TASK", v: 1, reqId: makeId(), taskId });
  }, []);

  const handleDeleteDependency = useCallback((dependencyId: string) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "DELETE_DEPENDENCY", v: 1, reqId: makeId(), dependencyId });
  }, []);

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

  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId) ?? null,
    [resources, selectedResourceId],
  );

  const workspaceShellView = useMemo(
    () => deriveWorkspaceShellView({ hasImportPreview: importPreview !== null, hasTasks: tasks.length > 0 }),
    [importPreview, tasks.length],
  );

  useEffect(() => {
    const defaultsKey = "r3-shell-defaults-applied";
    if (window.sessionStorage.getItem(defaultsKey) === "1") {
      return;
    }

    // R3 shell baseline: start with inspector/diagnostics closed and all tasks visible.
    // This intentionally normalizes first-render view defaults for visual QA.
    setInspectorOpen(false);
    toggleBottomDrawer(false);
    setConstraintFilter("all");
    window.sessionStorage.setItem(defaultsKey, "1");
  }, [setInspectorOpen, toggleBottomDrawer, setConstraintFilter]);

  const handleSelect = useCallback((sel: Selection) => {
    setSelection(sel);
  }, []);

  const handleToggleCollapse = useCallback((taskId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // Keyboard: Delete / Backspace dispatches delete for the selected entity
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selection) return;
      e.preventDefault();
      if (selection.type === "task") handleDeleteTask(selection.id);
      if (selection.type === "dependency") handleDeleteDependency(selection.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, handleDeleteTask, handleDeleteDependency]);

  const handleLinkLastTwo = () => {
    if (!workerRef.current || tasks.length < 2) return;

    const pred = tasks[tasks.length - 2];
    const succ = tasks[tasks.length - 1];

    const dep: Dependency = {
      id: makeId(),
      predId: pred.id,
      succId: succ.id,
      type: "FS",
      lag: 0,
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

  const warningCount = importPreview?.diagnosticsSummary.warnings ?? 0;
  const errorCount = importPreview?.diagnosticsSummary.errors ?? 0;
  const fileName = importPreview ? `Preview (${importPreview.format.toUpperCase()})` : "—";
  const projectName = importPreview?.projectName ?? "Untitled";
  const importFormatLabel = importPreview
    ? importPreview.format === "xer" ? "XER" : "MSP-XML"
    : undefined;
  // importCanCommit mirrors the Worker-authoritative canCommit field from the IMPORT_PREVIEW message.
  // It gates the Load to Workspace action in CommandToolbar without duplicating commit rules in React.
  const importCanCommit = importPreview?.canCommit ?? false;

  const importStatus: ImportStatus = deriveImportStatus({
    hasPreview: importPreview !== null,
    errorCount,
    warningCount,
  });

  return (
    <WorkspaceContainer>
      <MainWorkspace>
        <AppShell
          menuBar={<MenuBar />}
          commandBar={
            <CommandToolbar
              onImport={() => fileInputRef.current?.click()}
              onLoadToWorkspace={handleImportCommit}
              onCancelPreview={handleImportCancel}
              onToggleInspector={() => setInspectorOpen((prev) => !prev)}
              onToggleDiagnostics={() => toggleBottomDrawer()}
              onConstraintFilterChange={setConstraintFilter}
              hasPreview={importPreview !== null}
              hasLoadedData={workspaceShellView === "loaded"}
              inspectorOpen={isInspectorOpen}
              diagnosticsOpen={isBottomOpen}
              constraintFilter={constraintFilter}
              workerReady={workerReady}
              importStatus={importStatus}
              importFormat={importFormatLabel}
              importErrorCount={errorCount}
              importWarningCount={warningCount}
              importCanCommit={importCanCommit}
            />
          }
          statusStrip={
            <ProjectStatusStrip
              projectName={projectName}
              fileName={fileName}
              activityCount={tasks.length}
              visibleActivityCount={visibleTasks.length}
              dependencyCount={dependencies.length}
              warningCount={warningCount}
              constraintFilter={constraintFilter}
              viewState={workspaceShellView}
              workerReady={workerReady}
              importFormat={importFormatLabel}
              importErrorCount={errorCount}
            />
          }
        >
          <WorkspaceLayout
            showInspector={isInspectorOpen && workspaceShellView === "loaded"}
            inspector={<InspectorPanel />}
          >
            {workspaceShellView === "empty" && (
              <EmptyWorkspace onImport={() => fileInputRef.current?.click()} />
            )}

            {workspaceShellView === "preview" && importPreview && (
              <ProgrammePreviewPanel data={importPreview} onImport={handleImportCommit} onCancel={handleImportCancel} />
            )}

            {workspaceShellView === "loaded" && (
              <ScheduleWorkspace>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, fontFamily: "Arial, sans-serif" }}>
                  <div style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', background: '#f5f5f5', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', flexShrink: 0 }}>
                    <input
                      value={taskName}
                      onChange={(e) => setTaskName(e.target.value)}
                      placeholder="Task name"
                      style={{ height: 28, padding: '0 6px', flex: '0 1 200px', minWidth: 100, boxSizing: 'border-box', fontSize: 12 }}
                    />
                    <select
                      value={selectedParentId}
                      onChange={(e) => setSelectedParentId(e.target.value)}
                      style={{ height: 28, fontSize: 12 }}
                    >
                      <option value="">(no parent)</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button onClick={handleAdd} disabled={!canAdd} style={{ height: 28, padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      Add Task
                    </button>
                    <button onClick={handleLinkLastTwo} disabled={tasks.length < 2} style={{ height: 28, padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      Link Last Two
                    </button>
                    <button
                      onClick={() => workerRef.current?.postMessage({ type: "SNAPSHOT_BASELINE", v: 1, reqId: makeId() })}
                      disabled={!workerReady || Object.keys(scheduleResults).length === 0}
                      style={{ height: 28, padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                    >
                      Set Baseline
                    </button>
                    <button
                      onClick={() => workerRef.current?.postMessage({ type: "CLEAR_BASELINE", v: 1, reqId: makeId() })}
                      disabled={!workerReady || Object.keys(baselines).length === 0}
                      style={{ height: 28, padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                    >
                      Clear Baseline
                    </button>
                    <button
                      onClick={() => workerRef.current?.postMessage({ type: "UNDO", v: 1, reqId: makeId() })}
                      disabled={!canUndo}
                      style={{ height: 28, padding: '0 10px', fontSize: 12 }}
                    >
                      Undo
                    </button>
                    <button
                      onClick={() => workerRef.current?.postMessage({ type: "REDO", v: 1, reqId: makeId() })}
                      disabled={!canRedo}
                      style={{ height: 28, padding: '0 10px', fontSize: 12 }}
                    >
                      Redo
                    </button>
                    {resources.length > 0 && (
                      <select
                        value={selectedResourceId ?? ""}
                        onChange={(e) => setSelectedResourceId(e.target.value || null)}
                        style={{ height: 28, fontSize: 12 }}
                      >
                        {resources.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div ref={mainContentRowRef} style={{ display: "flex", flex: 1, overflow: "hidden" }} onWheel={handleWheel}>
                    <div ref={tableContainerRef} style={{ width: tableWidth, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%" }}>
                      <TaskTable
                        tasks={visibleTasks}
                        scheduleResults={scheduleResults}
                        variances={variances}
                        diagnosticsMap={diagnosticsMap}
                        onUpdateTask={handleUpdateTask}
                        scrollTop={scrollTop}
                        viewportHeight={viewportHeight}
                        projectStartDate={projectStartDate}
                        selectedTaskId={selection?.type === "task" ? selection.id : null}
                        onSelectTask={(id) => handleSelect({ type: "task", id })}
                        collapsedIds={collapsedIds}
                        onToggleCollapse={handleToggleCollapse}
                        bodyRef={tableBodyRef}
                      />
                    </div>
                    <WorkspaceSplitter tableRef={tableContainerRef} containerRef={mainContentRowRef} lowerAxisRef={histogramAxisRef} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
                      <GanttPane
                        tasks={visibleTasks}
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
                        onHScrollMount={handleGanttHScrollMount}
                        bodyRef={ganttBodyRef}
                      />
                    </div>

                    <div
                      ref={handleScrollTrackRef}
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
              </ScheduleWorkspace>
            )}
          </WorkspaceLayout>
        </AppShell>
      </MainWorkspace>

      <BottomDiagnosticsDrawer
        isOpen={isBottomOpen}
        onToggle={() => toggleBottomDrawer()}
      >
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #d5dbe3", fontSize: 12, fontWeight: 600 }}>
          Diagnostics Drawer
        </div>
          {activeBottomTab === 'task-details' ? (
            <TaskDetailsPanel
              dependencies={dependencies}
              tasks={tasks}
              getTaskName={getTaskName}
              onUpdateDependencyType={handleUpdateDependencyType}
              onUpdateDependencyLag={handleUpdateDependencyLag}
              onDeleteDependency={handleDeleteDependency}
              onAddDependency={handleAddDependency}
              resources={resources}
              assignments={assignments}
              resourceName={resourceName}
              onResourceNameChange={setResourceName}
              onAddResource={handleAddResource}
              onDeleteResource={handleDeleteResource}
              onAddAssignment={handleAddAssignment}
              onDeleteAssignment={handleDeleteAssignment}
              selectedTask={selection?.type === "task" ? tasks.find(t => t.id === selection.id) ?? null : null}
              onUpdateTask={handleUpdateTask}
              diagnosticsMap={diagnosticsMap}
            />
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
      </BottomDiagnosticsDrawer>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xer,.xml"
        style={{ display: "none" }}
        onChange={handleImportFileSelect}
      />
    </WorkspaceContainer>
  );
}
