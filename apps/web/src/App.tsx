import type { Assignment, BaselineMap, Dependency, DependencyType, DiagnosticsMap, Resource, ResourceHistogram, ScheduleResultMap, Task, VarianceMap, WorkerMessage } from "protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GanttPane } from "./components/gantt/GanttPane";
import { HistogramPane } from "./components/HistogramPane";
import { TaskDetailsPanel } from "./components/TaskDetailsPanel";
import { TaskTable } from "./components/TaskTable";
import { BottomDrawer } from "./ui/components/drawer/BottomDrawer";
import { MainWorkspace } from "./ui/components/shell/MainWorkspace";
import { WorkspaceContainer } from "./ui/components/shell/WorkspaceContainer";
import { WorkspaceSplitter } from "./ui/components/WorkspaceSplitter";
import { HEADER_METRICS } from "./ui/config/themeConfig";
import { useDensityMetrics, useUIStore } from "./ui/store/uiStore";
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
  const setStatusText = useUIStore((s) => s.setStatusText);
  const constraintFilter = useUIStore((s) => s.constraintFilter);
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
  const scrollTrackRef = useRef<HTMLDivElement>(null);
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
  const [ganttScrollLeft, setGanttScrollLeft] = useState(0);
  const [ganttPaneWidth, setGanttPaneWidth] = useState(0);
  const ganttScrollElRef = useRef<HTMLDivElement | null>(null);

  const handleGanttHScrollMount = useCallback((el: HTMLDivElement | null) => {
    ganttScrollElRef.current = el;
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
  useEffect(() => {
    const el = scrollTrackRef.current;
    if (!el) return;

    const measure = () => setViewportHeight(el.clientHeight);
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

  const handleGanttScrollLeftChange = useCallback((sl: number, pw: number) => {
    setGanttScrollLeft(sl);
    setGanttPaneWidth(pw);
  }, []);

  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId) ?? null,
    [resources, selectedResourceId],
  );

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

  return (
    <WorkspaceContainer>
      <MainWorkspace>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, fontFamily: "Arial, sans-serif" }}>
          {/* Compressed controls header */}
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

          {/* Main content: table + gantt + shared vertical scroll track */}
          <div ref={mainContentRowRef} style={{ display: "flex", flex: 1, overflow: "hidden" }} onWheel={handleWheel}>
            {/* Left upper pane — fixed width from tableWidth, full height */}
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
            {/* Right pane: Gantt only (histogram moved to BottomDrawer) */}
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
                onScrollLeftChange={handleGanttScrollLeftChange}
                onHScrollMount={handleGanttHScrollMount}
                bodyRef={ganttBodyRef}
              />
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
        </BottomDrawer>
      )}
    </WorkspaceContainer>
  );
}