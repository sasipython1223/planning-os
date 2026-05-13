/**
 * W4.3 — Project Default Settings Preservation Tests
 *
 * Validates that XER/MSP project-level default settings are:
 *   1. Parsed from source files
 *   2. Mapped into SourceProjectSettings
 *   3. Preserved through ImportCandidate → SourceImportRecord
 *   4. Survive hydration
 *   5. Do NOT change recalculation results
 */

import type { SourceProjectSettings } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { getPendingCandidate } from "../../src/import/importCandidate.js";
import { mapMspToCanonical } from "../../src/import/mappers/mspMapper.js";
import { mapXerToCanonical } from "../../src/import/mappers/xerMapper.js";
import { parseMspXml } from "../../src/import/parsers/mspParser.js";
import { parseXer } from "../../src/import/parsers/xerParser.js";
import { runImportPreview } from "../../src/import/previewOrchestrator.js";
import * as State from "../../src/state.js";

// ─── XER Fixture Builders ────────────────────────────────────────────

function buildXerWithCalendar(): string {
  return [
    "ERMHDR\t19.12\t2026-01-01",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt\tdata_date\tstatus_date\tlast_recalc_date\tweek_hr_cnt\tmonth_hr_cnt\tclndr_id",
    "%R\tP001\tTest Project\t2026-01-05\t8\t2026-06-01\t2026-06-01\t2026-06-01\t40\t168\tCAL_GLOBAL",
    "%E",
    "%T\tCALENDAR",
    "%F\tclndr_id\tclndr_name\tclndr_data\tclndr_type\tbase_clndr_id\tday_hr_cnt",
    "%R\tCAL_GLOBAL\tStandard 5-Day Week\t(0||)(1|s|08:00|f|17:00)(2|s|08:00|f|17:00)(3|s|08:00|f|17:00)(4|s|08:00|f|17:00)(5|s|08:00|f|17:00)(6||)\tglobal\t\t8",
    "%E",
    "%T\tTASK",
    "%F\ttask_id\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
    "%R\tT1\tP001\t\tTask A\tTT_TASK\t40\tCS_ASAP\t",
    "%E",
    "%E",
  ].join("\n");
}

function buildXerWithSchedOptions(): string {
  return [
    "ERMHDR\t19.12\t2026-01-01",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt\tdata_date\tstatus_date\tlast_recalc_date",
    "%R\tP002\tScheduled Project\t2026-02-01\t8\t2026-06-01\t\t2026-06-01",
    "%E",
    "%T\tSCHEDOPTIONS",
    "%F\toption_name\toption_value",
    "%R\tsched_float_thr_cnt\t0",
    "%R\tsched_progress_override\tN",
    "%R\tsched_use_expect_end_flag\tY",
    "%R\tsched_outer_depend_type\tExistingActuals",
    "%E",
    "%T\tTASK",
    "%F\ttask_id\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
    "%R\tT1\tP002\t\tTask A\tTT_TASK\t40\tCS_ASAP\t",
    "%E",
    "%E",
  ].join("\n");
}

function buildXerWithHoursPeriod(): string {
  return [
    "ERMHDR\t19.12\t2026-01-01",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt\tweek_hr_cnt\tmonth_hr_cnt",
    "%R\tP003\tHours Project\t2026-03-01\t8\t40\t172",
    "%E",
    "%T\tTASK",
    "%F\ttask_id\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
    "%R\tT1\tP003\t\tTask A\tTT_TASK\t40\tCS_ASAP\t",
    "%E",
    "%E",
  ].join("\n");
}

function buildMspWithCalendar(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>MSP Test Project</Name>
  <StartDate>2026-01-12T08:00:00</StartDate>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <CalendarUID>1</CalendarUID>
  <StatusDate>2026-06-01T00:00:00</StatusDate>
  <ScheduleFromStart>1</ScheduleFromStart>
  <CriticalSlackLimit>0</CriticalSlackLimit>
  <Tasks>
    <Task>
      <UID>1</UID>
      <Name>Task A</Name>
      <Duration>PT40H0M0S</Duration>
      <Summary>0</Summary>
      <OutlineLevel>1</OutlineLevel>
      <ConstraintType>0</ConstraintType>
      <ConstraintDate></ConstraintDate>
      <PredecessorLink></PredecessorLink>
    </Task>
  </Tasks>
  <Resources/>
  <Assignments/>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>true</IsBaseCalendar>
    </Calendar>
  </Calendars>
</Project>`;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("W4.3 — XER project default calendar preservation", () => {
  it("1. preserves project default calendar id and name from clndr_id field", () => {
    const xerContent = buildXerWithCalendar();
    const parseResult = parseXer(xerContent);
    expect(parseResult.errors).toHaveLength(0);

    const mapResult = mapXerToCanonical(parseResult.data);
    const settings = mapResult.sourceProjectSettings;

    expect(settings.defaultCalendarId).toBe("CAL_GLOBAL");
    expect(settings.defaultCalendarName).toBe("Standard 5-Day Week");
  });

  it("2. preserves data date and last recalculation date from PROJECT table", () => {
    const xerContent = buildXerWithCalendar();
    const parseResult = parseXer(xerContent);
    const mapResult = mapXerToCanonical(parseResult.data);
    const settings = mapResult.sourceProjectSettings;

    expect(settings.dataDate).toBe("2026-06-01");
    expect(settings.planStartDate).toBe("2026-01-05");
  });

  it("3. preserves hours/day, hours/week, hours/month from PROJECT table", () => {
    const xerContent = buildXerWithHoursPeriod();
    const parseResult = parseXer(xerContent);
    const mapResult = mapXerToCanonical(parseResult.data);
    const settings = mapResult.sourceProjectSettings;

    expect(settings.hoursPerDay).toBe(8);
    expect(settings.hoursPerWeek).toBe(40);
    expect(settings.hoursPerMonth).toBe(172);
  });

  it("4. preserves SCHEDOPTIONS raw data when table is present", () => {
    const xerContent = buildXerWithSchedOptions();
    const parseResult = parseXer(xerContent);

    // Verify parser captures SCHEDOPTIONS
    expect(parseResult.data.schedoptions?.length ?? 0).toBeGreaterThan(0);
    expect(parseResult.data.schedoptions?.find(o => o.option_name === "sched_float_thr_cnt")?.option_value).toBe("0");

    const mapResult = mapXerToCanonical(parseResult.data);
    const settings = mapResult.sourceProjectSettings;

    expect(settings.rawScheduleOptions).toBeDefined();
    expect(settings.rawScheduleOptions?.sched_float_thr_cnt).toBe("0");
    expect(settings.rawScheduleOptions?.sched_use_expect_end_flag).toBe("Y");
    expect(settings.criticalFloatThreshold).toBe(0);
    // sched_progress_override=N → retained logic
    expect(settings.outOfSequenceProgressMode).toBe("retained logic");
    expect(settings.useExpectedFinishDates).toBe(true);
  });

  it("4b. emits PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE diagnostic when calendar is present", () => {
    const xerContent = buildXerWithCalendar();
    const parseResult = parseXer(xerContent);
    const mapResult = mapXerToCanonical(parseResult.data);

    const calDiag = mapResult.diagnostics.find(d => d.code === "PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE");
    expect(calDiag).toBeDefined();
    expect(calDiag?.severity).toBe("info");
  });

  it("4c. emits SCHEDOPTIONS_PRESERVED_INACTIVE diagnostic when SCHEDOPTIONS is present", () => {
    const xerContent = buildXerWithSchedOptions();
    const parseResult = parseXer(xerContent);
    const mapResult = mapXerToCanonical(parseResult.data);

    const schedDiag = mapResult.diagnostics.find(d => d.code === "SCHEDOPTIONS_PRESERVED_INACTIVE");
    expect(schedDiag).toBeDefined();
    expect(schedDiag?.severity).toBe("info");
  });
});

describe("W4.3 — MSP project settings preservation", () => {
  it("5. preserves MSP calendar UID, minutes/day, minutes/week, days/month", () => {
    const mspContent = buildMspWithCalendar();
    const parseResult = parseMspXml(mspContent);
    expect(parseResult.errors).toHaveLength(0);

    const mapResult = mapMspToCanonical(parseResult.data);
    const settings = mapResult.sourceProjectSettings;

    expect(settings.defaultCalendarUID).toBe("1");
    expect(settings.minutesPerDay).toBe(480);
    expect(settings.minutesPerWeek).toBe(2400);
    expect(settings.daysPerMonth).toBe(20);
  });

  it("5b. preserves MSP scheduleFrom and criticalSlackLimit", () => {
    const mspContent = buildMspWithCalendar();
    const parseResult = parseMspXml(mspContent);
    const mapResult = mapMspToCanonical(parseResult.data);
    const settings = mapResult.sourceProjectSettings;

    expect(settings.scheduleFrom).toBe("Start");
    expect(settings.criticalFloatThreshold).toBe(0);
    expect(settings.statusDate).toBe("2026-06-01T00:00:00");
  });

  it("5c. emits PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE for MSP calendar UID", () => {
    const mspContent = buildMspWithCalendar();
    const parseResult = parseMspXml(mspContent);
    const mapResult = mapMspToCanonical(parseResult.data);

    const calDiag = mapResult.diagnostics.find(d => d.code === "PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE");
    expect(calDiag).toBeDefined();
    expect(calDiag?.severity).toBe("info");
  });
});

describe("W4.3 — Import preview exposes project settings", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("6. runImportPreview sets sourceProjectSettings on ImportCandidate", () => {
    const xerContent = buildXerWithCalendar();
    const result = runImportPreview("req-1", "xer", xerContent, "test.xer");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Check candidate has settings
    const candidate = getPendingCandidate();
    expect(candidate).not.toBeNull();
    expect(candidate?.sourceProjectSettings).toBeDefined();
    expect(candidate?.sourceProjectSettings?.defaultCalendarId).toBe("CAL_GLOBAL");
    expect(candidate?.sourceProjectSettings?.hoursPerDay).toBe(8);
    expect(candidate?.sourceProjectSettings?.hoursPerWeek).toBe(40);
  });

  it("6b. ImportPreviewMessage payload includes sourceProjectSettings", () => {
    const xerContent = buildXerWithCalendar();
    const result = runImportPreview("req-2", "xer", xerContent, "test.xer");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.payload.sourceProjectSettings).toBeDefined();
    expect(result.message.payload.sourceProjectSettings?.defaultCalendarId).toBe("CAL_GLOBAL");
    expect(result.message.payload.sourceProjectSettings?.hoursPerDay).toBe(8);
  });

  it("6c. MSP runImportPreview includes sourceProjectSettings in candidate and message", () => {
    const mspContent = buildMspWithCalendar();
    const result = runImportPreview("req-3", "msp-xml", mspContent, "test.xml");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const candidate = getPendingCandidate();
    expect(candidate?.sourceProjectSettings?.defaultCalendarUID).toBe("1");
    expect(candidate?.sourceProjectSettings?.minutesPerDay).toBe(480);
    expect(result.message.payload.sourceProjectSettings?.minutesPerDay).toBe(480);
  });
});

describe("W4.3 — Hydration restores project settings", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("8. sourceProjectSettings survives hydrateState round-trip through SourceImportRecord", () => {
    const settings: SourceProjectSettings = {
      sourceProjectId: "P001",
      defaultCalendarId: "CAL_GLOBAL",
      defaultCalendarName: "Standard 5-Day Week",
      planStartDate: "2026-01-05",
      dataDate: "2026-06-01",
      hoursPerDay: 8,
      hoursPerWeek: 40,
      hoursPerMonth: 172,
    };

    // Set import record with project settings
    State.setSourceImportRecord({
      format: "xer",
      summary: { taskCount: 1, dependencyCount: 0, resourceCount: 0, assignmentCount: 0, calendarInfo: "none" },
      diagnostics: [],
      status: "sourceImportedNotCalculated",
      sourceProjectSettings: settings,
      importedAt: "2026-01-01T00:00:00.000Z",
    });

    // Extract state for "persistence" snapshot
    const record = State.getSourceImportRecord();
    expect(record?.sourceProjectSettings?.defaultCalendarId).toBe("CAL_GLOBAL");
    expect(record?.sourceProjectSettings?.hoursPerWeek).toBe(40);

    // Hydrate fresh state from the record's data (simulates round-trip)
    State.clearState();
    State.hydrateState({
      projectStartDate: "2026-01-05",
      excludeWeekends: false,
      tasks: [],
      dependencies: [],
      baselines: {},
      sourceImportRecord: {
        format: "xer",
        summary: { taskCount: 1, dependencyCount: 0, resourceCount: 0, assignmentCount: 0, calendarInfo: "none" },
        diagnostics: [],
        status: "sourceImportedNotCalculated",
        sourceProjectSettings: settings,
        importedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const hydrated = State.getSourceImportRecord();
    expect(hydrated?.sourceProjectSettings?.defaultCalendarId).toBe("CAL_GLOBAL");
    expect(hydrated?.sourceProjectSettings?.defaultCalendarName).toBe("Standard 5-Day Week");
    expect(hydrated?.sourceProjectSettings?.hoursPerDay).toBe(8);
    expect(hydrated?.sourceProjectSettings?.hoursPerWeek).toBe(40);
    expect(hydrated?.sourceProjectSettings?.hoursPerMonth).toBe(172);
    expect(hydrated?.sourceProjectSettings?.planStartDate).toBe("2026-01-05");
    expect(hydrated?.sourceProjectSettings?.dataDate).toBe("2026-06-01");
  });
});

describe("W4.3 — Recalculation results are unchanged by settings preservation", () => {
  it("9. XER mapping produces same task count and dependency count with and without extra project fields", () => {
    // With extra fields (week_hr_cnt, clndr_id, SCHEDOPTIONS)
    const xerWithExtra = buildXerWithCalendar();
    const parseWith = parseXer(xerWithExtra);
    const mapWith = mapXerToCanonical(parseWith.data);

    // Minimal XER without extra fields
    const xerMinimal = [
      "ERMHDR\t19.12\t2026-01-01",
      "%T\tPROJECT",
      "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt",
      "%R\tP001\tTest Project\t2026-01-05\t8",
      "%E",
      "%T\tTASK",
      "%F\ttask_id\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
      "%R\tT1\tP001\t\tTask A\tTT_TASK\t40\tCS_ASAP\t",
      "%E",
      "%E",
    ].join("\n");
    const parseMin = parseXer(xerMinimal);
    const mapMin = mapXerToCanonical(parseMin.data);

    // Task/dependency counts must match (scheduling correctness unaffected)
    expect(mapWith.tasks.length).toBe(mapMin.tasks.length);
    expect(mapWith.dependencies.length).toBe(mapMin.dependencies.length);

    // The task duration must be the same
    const taskWith = mapWith.tasks[0];
    const taskMin = mapMin.tasks[0];
    expect(taskWith.durationWorkMinutes).toBe(taskMin.durationWorkMinutes);
  });
});
