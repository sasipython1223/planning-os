/**
 * MSP XML Parser Unit Tests — W.6
 *
 * Tests the parseMspXml function against crafted MSP XML content.
 * Parser is isolated: no protocol, state, or kernel imports.
 */

import { describe, expect, it } from "vitest";
import { parseMspXml } from "../../src/import/parsers/mspParser.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a minimal valid MSP XML string with custom inner content. */
function buildMspXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Project xmlns="http://schemas.microsoft.com/project">\n${inner}\n</Project>`;
}

function projectMeta(name = "Test Project", startDate = "2026-01-15T08:00:00", minutesPerDay = "480"): string {
  return `<Name>${name}</Name><StartDate>${startDate}</StartDate><MinutesPerDay>${minutesPerDay}</MinutesPerDay>`;
}

function taskXml(uid: string, name: string, opts: { id?: string; duration?: string; summary?: string; outlineLevel?: string; constraintType?: string; constraintDate?: string; predecessorLinks?: string } = {}): string {
  const id = opts.id ? `<ID>${opts.id}</ID>` : "";
  const dur = opts.duration ?? "PT40H0M0S";
  const smry = opts.summary ?? "0";
  const ol = opts.outlineLevel ?? "1";
  const ct = opts.constraintType ?? "0";
  const cd = opts.constraintDate ? `<ConstraintDate>${opts.constraintDate}</ConstraintDate>` : "";
  const pls = opts.predecessorLinks ?? "";
  return `<Task><UID>${uid}</UID>${id}<Name>${name}</Name><Duration>${dur}</Duration><Summary>${smry}</Summary><OutlineLevel>${ol}</OutlineLevel><ConstraintType>${ct}</ConstraintType>${cd}${pls}</Task>`;
}

function predecessorLinkXml(predUID: string, type = "1", lag = "0"): string {
  return `<PredecessorLink><PredecessorUID>${predUID}</PredecessorUID><Type>${type}</Type><LinkLag>${lag}</LinkLag></PredecessorLink>`;
}

function resourceXml(uid: string, name: string, maxUnits = "100"): string {
  return `<Resource><UID>${uid}</UID><Name>${name}</Name><MaxUnits>${maxUnits}</MaxUnits></Resource>`;
}

function assignmentXml(uid: string, taskUID: string, resourceUID: string, units = "100"): string {
  return `<Assignment><UID>${uid}</UID><TaskUID>${taskUID}</TaskUID><ResourceUID>${resourceUID}</ResourceUID><Units>${units}</Units></Assignment>`;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("MSP XML Parser (W.6)", () => {

  describe("XML structure validation", () => {
    it("should reject malformed XML", () => {
      const result = parseMspXml("<not valid xml>>>");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("XML validation failed");
    });

    it("should reject XML without <Project> root", () => {
      const result = parseMspXml('<?xml version="1.0"?><Data></Data>');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("Missing root <Project>");
    });

    it("should reject empty input", () => {
      const result = parseMspXml("");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject whitespace-only input", () => {
      const result = parseMspXml("   \n  ");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should accept a minimal valid MSP XML", () => {
      const result = parseMspXml(buildMspXml(projectMeta()));
      expect(result.errors).toHaveLength(0);
      expect(result.data.project.name).toBe("Test Project");
      expect(result.data.tasks).toHaveLength(0);
    });
  });

  describe("project metadata", () => {
    it("should extract project name, startDate, minutesPerDay", () => {
      const xml = buildMspXml(projectMeta("My Schedule", "2026-03-01T08:00:00", "480"));
      const result = parseMspXml(xml);
      expect(result.data.project.name).toBe("My Schedule");
      expect(result.data.project.startDate).toBe("2026-03-01T08:00:00");
      expect(result.data.project.minutesPerDay).toBe("480");
    });
  });

  describe("task parsing", () => {
    it("should parse tasks from <Tasks> container", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Task A", { id: "10" })}
          ${taskXml("2", "Task B", { duration: "PT80H0M0S" })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.tasks[0].uid).toBe("1");
      expect(result.data.tasks[0].id).toBe("10");
      expect(result.data.tasks[0].name).toBe("Task A");
      expect(result.data.tasks[1].uid).toBe("2");
      expect(result.data.tasks[1].duration).toBe("PT80H0M0S");
    });

    it("should warn on task missing UID", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks><Task><Name>No UID</Name></Task></Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain("missing UID");
    });

    it("should parse summary tasks", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Phase 1", { summary: "1", outlineLevel: "1" })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks[0].summary).toBe("1");
      expect(result.data.tasks[0].outlineLevel).toBe("1");
    });

    it("should parse predecessor links", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Task A")}
          ${taskXml("2", "Task B", { predecessorLinks: predecessorLinkXml("1", "1", "4800") })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks[1].predecessorLinks).toHaveLength(1);
      expect(result.data.tasks[1].predecessorLinks[0].predecessorUID).toBe("1");
      expect(result.data.tasks[1].predecessorLinks[0].type).toBe("1");
      expect(result.data.tasks[1].predecessorLinks[0].linkLag).toBe("4800");
    });

    it("should parse constraint type and date", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Constrained", { constraintType: "4", constraintDate: "2026-02-01T08:00:00" })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks[0].constraintType).toBe("4");
      expect(result.data.tasks[0].constraintDate).toBe("2026-02-01T08:00:00");
    });
  });

  describe("resource parsing", () => {
    it("should parse resources from <Resources> container", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Resources>
          ${resourceXml("1", "Engineer", "100")}
          ${resourceXml("2", "Designer", "50")}
        </Resources>`);
      const result = parseMspXml(xml);
      expect(result.data.resources).toHaveLength(2);
      expect(result.data.resources[0].uid).toBe("1");
      expect(result.data.resources[0].name).toBe("Engineer");
      expect(result.data.resources[0].maxUnits).toBe("100");
    });

    it("should warn on resource missing UID", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Resources><Resource><Name>No UID</Name></Resource></Resources>`);
      const result = parseMspXml(xml);
      expect(result.data.resources).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("assignment parsing", () => {
    it("should parse assignments from <Assignments> container", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>${taskXml("1", "Task A")}</Tasks>
        <Resources>${resourceXml("1", "Engineer")}</Resources>
        <Assignments>
          ${assignmentXml("1", "1", "1", "100")}
        </Assignments>`);
      const result = parseMspXml(xml);
      expect(result.data.assignments).toHaveLength(1);
      expect(result.data.assignments[0].taskUID).toBe("1");
      expect(result.data.assignments[0].resourceUID).toBe("1");
    });

    it("should warn on assignment missing UID", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Assignments><Assignment><TaskUID>1</TaskUID></Assignment></Assignments>`);
      const result = parseMspXml(xml);
      expect(result.data.assignments).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("empty sections", () => {
    it("should return empty arrays when sections are absent", () => {
      const xml = buildMspXml(projectMeta());
      const result = parseMspXml(xml);
      expect(result.data.tasks).toHaveLength(0);
      expect(result.data.resources).toHaveLength(0);
      expect(result.data.assignments).toHaveLength(0);
    });
  });

  describe("BOM handling (W.6.1)", () => {
    it("should strip UTF-8 BOM and parse successfully", () => {
      const bom = "\uFEFF";
      const xml = bom + buildMspXml(`${projectMeta("BOM Project")}
        <Tasks>${taskXml("1", "Task A")}</Tasks>
        <Resources>${resourceXml("1", "Engineer")}</Resources>
        <Assignments>${assignmentXml("1", "1", "1")}</Assignments>`);
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.project.name).toBe("BOM Project");
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.resources).toHaveLength(1);
      expect(result.data.assignments).toHaveLength(1);
    });

    it("should strip BOM even when followed by whitespace", () => {
      const bom = "\uFEFF";
      const xml = bom + "   " + buildMspXml(projectMeta("Whitespace"));
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.project.name).toBe("Whitespace");
    });
  });

  describe("namespace handling (W.6.1)", () => {
    /** Build MSP XML with an explicit namespace prefix. */
    function buildNamespacedXml(inner: string): string {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<msproject:Project xmlns:msproject="http://schemas.microsoft.com/project">\n${inner}\n</msproject:Project>`;
    }

    it("should parse tasks from namespace-prefixed XML", () => {
      const xml = buildNamespacedXml(`
        <msproject:Name>NS Project</msproject:Name>
        <msproject:StartDate>2026-01-15T08:00:00</msproject:StartDate>
        <msproject:MinutesPerDay>480</msproject:MinutesPerDay>
        <msproject:Tasks>
          <msproject:Task>
            <msproject:UID>1</msproject:UID>
            <msproject:Name>Task NS</msproject:Name>
            <msproject:Duration>PT40H0M0S</msproject:Duration>
            <msproject:Summary>0</msproject:Summary>
            <msproject:OutlineLevel>1</msproject:OutlineLevel>
            <msproject:ConstraintType>0</msproject:ConstraintType>
          </msproject:Task>
        </msproject:Tasks>`);
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.project.name).toBe("NS Project");
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].name).toBe("Task NS");
    });

    it("should parse resources and assignments from namespace-prefixed XML", () => {
      const xml = buildNamespacedXml(`
        <msproject:Name>NS Project</msproject:Name>
        <msproject:StartDate>2026-01-15T08:00:00</msproject:StartDate>
        <msproject:MinutesPerDay>480</msproject:MinutesPerDay>
        <msproject:Tasks>
          <msproject:Task>
            <msproject:UID>1</msproject:UID>
            <msproject:Name>Task A</msproject:Name>
            <msproject:Duration>PT40H0M0S</msproject:Duration>
            <msproject:Summary>0</msproject:Summary>
            <msproject:OutlineLevel>1</msproject:OutlineLevel>
            <msproject:ConstraintType>0</msproject:ConstraintType>
          </msproject:Task>
        </msproject:Tasks>
        <msproject:Resources>
          <msproject:Resource>
            <msproject:UID>1</msproject:UID>
            <msproject:Name>Engineer</msproject:Name>
            <msproject:MaxUnits>100</msproject:MaxUnits>
          </msproject:Resource>
        </msproject:Resources>
        <msproject:Assignments>
          <msproject:Assignment>
            <msproject:UID>1</msproject:UID>
            <msproject:TaskUID>1</msproject:TaskUID>
            <msproject:ResourceUID>1</msproject:ResourceUID>
            <msproject:Units>100</msproject:Units>
          </msproject:Assignment>
        </msproject:Assignments>`);
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.resources).toHaveLength(1);
      expect(result.data.resources[0].name).toBe("Engineer");
      expect(result.data.assignments).toHaveLength(1);
      expect(result.data.assignments[0].taskUID).toBe("1");
    });

    it("should parse predecessor links from namespace-prefixed tasks", () => {
      const xml = buildNamespacedXml(`
        <msproject:Name>NS Project</msproject:Name>
        <msproject:StartDate>2026-01-15T08:00:00</msproject:StartDate>
        <msproject:MinutesPerDay>480</msproject:MinutesPerDay>
        <msproject:Tasks>
          <msproject:Task>
            <msproject:UID>1</msproject:UID>
            <msproject:Name>Task A</msproject:Name>
            <msproject:Duration>PT40H0M0S</msproject:Duration>
            <msproject:Summary>0</msproject:Summary>
            <msproject:OutlineLevel>1</msproject:OutlineLevel>
            <msproject:ConstraintType>0</msproject:ConstraintType>
          </msproject:Task>
          <msproject:Task>
            <msproject:UID>2</msproject:UID>
            <msproject:Name>Task B</msproject:Name>
            <msproject:Duration>PT40H0M0S</msproject:Duration>
            <msproject:Summary>0</msproject:Summary>
            <msproject:OutlineLevel>1</msproject:OutlineLevel>
            <msproject:ConstraintType>0</msproject:ConstraintType>
            <msproject:PredecessorLink>
              <msproject:PredecessorUID>1</msproject:PredecessorUID>
              <msproject:Type>1</msproject:Type>
              <msproject:LinkLag>0</msproject:LinkLag>
            </msproject:PredecessorLink>
          </msproject:Task>
        </msproject:Tasks>`);
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.tasks[1].predecessorLinks).toHaveLength(1);
      expect(result.data.tasks[1].predecessorLinks[0].predecessorUID).toBe("1");
    });
  });

  describe("parsererror detection (W.6.1)", () => {
    it("should report error for completely invalid XML", () => {
      const result = parseMspXml("this is not XML at all {{{");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("XML");
    });

    it("should report error for unclosed tags", () => {
      const result = parseMspXml('<?xml version="1.0"?><Project><Name>Test</Project>');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("diagnostic detail (W.6.2)", () => {
    it("should report found root keys when <Project> is missing", () => {
      const xml = '<?xml version="1.0"?><Schedule><Name>Oops</Name></Schedule>';
      const result = parseMspXml(xml);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("Schedule");
    });

    it("should report 'no root element' for non-XML garbage that validator catches", () => {
      const result = parseMspXml("this is not XML");
      expect(result.errors.length).toBeGreaterThan(0);
      // Error from adapter, includes input snippet for debugging
      expect(result.errors[0].message).toContain("XML");
    });

    it("should include input snippet in validation error", () => {
      const result = parseMspXml("<broken><unclosed>");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("input starts with");
    });
  });

  describe("realistic MSP XML fixture (W.6.2)", () => {
    /**
     * Comprehensive MSP XML fixture simulating a real MS Project export.
     * Includes: XML declaration with standalone, mso-application PI,
     * namespace, Calendars, ExtendedAttributes, self-closing tags,
     * &amp; entity, extra metadata, and multiple nested structures.
     */
    const REALISTIC_MSP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?mso-application progid="MSProject.Project"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <BuildNumber>16.0.17328.20162</BuildNumber>
  <Name>Construction Phase 1.xml</Name>
  <Company>Acme Corp</Company>
  <Author>Jane Engineer</Author>
  <CreationDate>2026-01-10T08:00:00</CreationDate>
  <LastSaved>2026-03-15T14:30:00</LastSaved>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>2026-02-01T08:00:00</StartDate>
  <FinishDate>2026-08-15T17:00:00</FinishDate>
  <FYStartDate>1</FYStartDate>
  <CriticalSlackLimit>0</CriticalSlackLimit>
  <CurrencyDigits>2</CurrencyDigits>
  <CurrencySymbol>$</CurrencySymbol>
  <CurrencyCode>USD</CurrencyCode>
  <CurrencySymbolPosition>0</CurrencySymbolPosition>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>08:00:00</DefaultStartTime>
  <DefaultFinishTime>17:00:00</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <DefaultTaskType>0</DefaultTaskType>
  <DefaultFixedCostAccrual>2</DefaultFixedCostAccrual>
  <DefaultStandardRate>0</DefaultStandardRate>
  <DefaultOvertimeRate>0</DefaultOvertimeRate>
  <DurationFormat>7</DurationFormat>
  <WorkFormat>2</WorkFormat>
  <EditableActualCosts>0</EditableActualCosts>
  <HonorConstraints>1</HonorConstraints>
  <InsertedProjectsLikeSummary>1</InsertedProjectsLikeSummary>
  <MultipleCriticalPaths>0</MultipleCriticalPaths>
  <NewTasksEffortDriven>1</NewTasksEffortDriven>
  <NewTasksEstimated>1</NewTasksEstimated>
  <SplitsInProgressTasks>1</SplitsInProgressTasks>
  <SpreadActualCost>0</SpreadActualCost>
  <SpreadPercentComplete>0</SpreadPercentComplete>
  <TaskUpdatesResource>1</TaskUpdatesResource>
  <FiscalYearStart>0</FiscalYearStart>
  <WeekStartDay>1</WeekStartDay>
  <MoveCompletedEndsBack>0</MoveCompletedEndsBack>
  <MoveRemainingStartsBack>0</MoveRemainingStartsBack>
  <MoveRemainingStartsForward>0</MoveRemainingStartsForward>
  <MoveCompletedEndsForward>0</MoveCompletedEndsForward>
  <BaselineForEarnedValue>0</BaselineForEarnedValue>
  <AutoAddNewResourcesAndTasks>1</AutoAddNewResourcesAndTasks>
  <CurrentDate>2026-03-19T08:00:00</CurrentDate>
  <MicrosoftProjectServerURL>1</MicrosoftProjectServerURL>
  <Autolink>1</Autolink>
  <NewTaskStartDate>0</NewTaskStartDate>
  <NewTasksAreManual>0</NewTasksAreManual>
  <DefaultTaskEVMethod>0</DefaultTaskEVMethod>
  <ProjectExternallyEdited>0</ProjectExternallyEdited>
  <ActualsInSync>0</ActualsInSync>
  <RemoveFileProperties>0</RemoveFileProperties>
  <AdminProject>0</AdminProject>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <IsBaselineCalendar>0</IsBaselineCalendar>
      <BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>
        <WeekDay>
          <DayType>1</DayType>
          <DayWorking>0</DayWorking>
        </WeekDay>
        <WeekDay>
          <DayType>7</DayType>
          <DayWorking>0</DayWorking>
        </WeekDay>
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
    <Task>
      <UID>0</UID>
      <ID>0</ID>
      <Name>Construction Phase 1</Name>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <CreateDate>2026-01-10T08:00:00</CreateDate>
      <WBS>0</WBS>
      <OutlineNumber>0</OutlineNumber>
      <OutlineLevel>0</OutlineLevel>
      <Priority>500</Priority>
      <Start>2026-02-01T08:00:00</Start>
      <Finish>2026-08-15T17:00:00</Finish>
      <Duration>PT1120H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Work>PT0H0M0S</Work>
      <ResumeValid>0</ResumeValid>
      <EffortDriven>0</EffortDriven>
      <Recurring>0</Recurring>
      <OverAllocated>0</OverAllocated>
      <Estimated>1</Estimated>
      <Milestone>0</Milestone>
      <Summary>1</Summary>
      <Critical>1</Critical>
      <IsSubproject>0</IsSubproject>
      <IsSubprojectReadOnly>0</IsSubprojectReadOnly>
      <ExternalTask>0</ExternalTask>
      <EarlyStart>2026-02-01T08:00:00</EarlyStart>
      <EarlyFinish>2026-08-15T17:00:00</EarlyFinish>
      <LateStart>2026-02-01T08:00:00</LateStart>
      <LateFinish>2026-08-15T17:00:00</LateFinish>
      <StartVariance>0</StartVariance>
      <FinishVariance>0</FinishVariance>
      <WorkVariance>0</WorkVariance>
      <FreeSlack>0</FreeSlack>
      <TotalSlack>0</TotalSlack>
      <FixedCost>0</FixedCost>
      <FixedCostAccrual>2</FixedCostAccrual>
      <PercentComplete>0</PercentComplete>
      <PercentWorkComplete>0</PercentWorkComplete>
      <Cost>0</Cost>
      <OvertimeCost>0</OvertimeCost>
      <OvertimeWork>PT0H0M0S</OvertimeWork>
      <ActualDuration>PT0H0M0S</ActualDuration>
      <ActualCost>0</ActualCost>
      <ActualOvertimeCost>0</ActualOvertimeCost>
      <ActualWork>PT0H0M0S</ActualWork>
      <ActualOvertimeWork>PT0H0M0S</ActualOvertimeWork>
      <RegularWork>PT0H0M0S</RegularWork>
      <RemainingDuration>PT1120H0M0S</RemainingDuration>
      <RemainingCost>0</RemainingCost>
      <RemainingWork>PT0H0M0S</RemainingWork>
      <RemainingOvertimeCost>0</RemainingOvertimeCost>
      <RemainingOvertimeWork>PT0H0M0S</RemainingOvertimeWork>
      <ACWP>0</ACWP>
      <CV>0</CV>
      <ConstraintType>0</ConstraintType>
      <CalendarUID>-1</CalendarUID>
      <LevelAssignments>1</LevelAssignments>
      <LevelingCanSplit>1</LevelingCanSplit>
      <LevelingDelay>0</LevelingDelay>
      <LevelingDelayFormat>8</LevelingDelayFormat>
      <IgnoreResourceCalendar>0</IgnoreResourceCalendar>
      <HideBar>0</HideBar>
      <Rollup>0</Rollup>
      <BCWS>0</BCWS>
      <BCWP>0</BCWP>
      <PhysicalPercentComplete>0</PhysicalPercentComplete>
      <EarnedValueMethod>0</EarnedValueMethod>
      <IsPublished>1</IsPublished>
      <CommitmentType>0</CommitmentType>
    </Task>
    <Task>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Phase 1 — Site Preparation</Name>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <CreateDate>2026-01-10T08:00:00</CreateDate>
      <WBS>1</WBS>
      <OutlineNumber>1</OutlineNumber>
      <OutlineLevel>1</OutlineLevel>
      <Priority>500</Priority>
      <Start>2026-02-01T08:00:00</Start>
      <Finish>2026-03-28T17:00:00</Finish>
      <Duration>PT320H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Summary>1</Summary>
      <ConstraintType>0</ConstraintType>
    </Task>
    <Task>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Survey &amp; Stake Out</Name>
      <Type>0</Type>
      <OutlineLevel>2</OutlineLevel>
      <Priority>500</Priority>
      <Start>2026-02-01T08:00:00</Start>
      <Finish>2026-02-07T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Summary>0</Summary>
      <ConstraintType>2</ConstraintType>
      <ConstraintDate>2026-02-01T08:00:00</ConstraintDate>
    </Task>
    <Task>
      <UID>3</UID>
      <ID>3</ID>
      <Name>Clearing &amp; Grubbing</Name>
      <Type>0</Type>
      <OutlineLevel>2</OutlineLevel>
      <Priority>500</Priority>
      <Start>2026-02-10T08:00:00</Start>
      <Finish>2026-02-21T17:00:00</Finish>
      <Duration>PT80H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Summary>0</Summary>
      <ConstraintType>0</ConstraintType>
      <PredecessorLink>
        <PredecessorUID>2</PredecessorUID>
        <Type>1</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>0</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>
    </Task>
    <Task>
      <UID>4</UID>
      <ID>4</ID>
      <Name>Grading &amp; Compaction</Name>
      <Type>0</Type>
      <OutlineLevel>2</OutlineLevel>
      <Duration>PT80H0M0S</Duration>
      <Summary>0</Summary>
      <ConstraintType>0</ConstraintType>
      <PredecessorLink>
        <PredecessorUID>3</PredecessorUID>
        <Type>1</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>4800</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>
    </Task>
  </Tasks>
  <Resources>
    <Resource>
      <UID>0</UID>
      <ID>0</ID>
      <Name></Name>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <MaxUnits>1.00</MaxUnits>
      <PeakUnits>0.00</PeakUnits>
      <OverAllocated>0</OverAllocated>
      <CanLevel>1</CanLevel>
      <AccrueAt>3</AccrueAt>
    </Resource>
    <Resource>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Survey Crew</Name>
      <Type>1</Type>
      <MaxUnits>1.00</MaxUnits>
      <StandardRate>0</StandardRate>
      <OvertimeRate>0</OvertimeRate>
      <CostPerUse>0</CostPerUse>
    </Resource>
    <Resource>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Heavy Equipment Operator</Name>
      <Type>1</Type>
      <MaxUnits>3.00</MaxUnits>
    </Resource>
  </Resources>
  <Assignments>
    <Assignment>
      <UID>1</UID>
      <TaskUID>2</TaskUID>
      <ResourceUID>1</ResourceUID>
      <Units>1</Units>
      <RegularWork>PT40H0M0S</RegularWork>
      <ActualWork>PT0H0M0S</ActualWork>
      <RemainingWork>PT40H0M0S</RemainingWork>
      <Work>PT40H0M0S</Work>
    </Assignment>
    <Assignment>
      <UID>2</UID>
      <TaskUID>3</TaskUID>
      <ResourceUID>2</ResourceUID>
      <Units>2</Units>
      <RegularWork>PT80H0M0S</RegularWork>
      <ActualWork>PT0H0M0S</ActualWork>
      <RemainingWork>PT80H0M0S</RemainingWork>
    </Assignment>
  </Assignments>
</Project>`;

    it("should parse full realistic MSP export without errors", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      expect(result.errors).toHaveLength(0);
    });

    it("should extract project metadata from realistic export", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      expect(result.data.project.name).toBe("Construction Phase 1.xml");
      expect(result.data.project.startDate).toBe("2026-02-01T08:00:00");
      expect(result.data.project.minutesPerDay).toBe("480");
    });

    it("should extract all tasks including project summary (UID 0)", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      // 5 tasks: UID 0 (project summary), 1 (phase), 2, 3, 4
      expect(result.data.tasks).toHaveLength(5);
      expect(result.data.tasks[0].uid).toBe("0");
      expect(result.data.tasks[0].summary).toBe("1");
      expect(result.data.tasks[1].uid).toBe("1");
      expect(result.data.tasks[1].outlineLevel).toBe("1");
    });

    it("should preserve XML entities in task names", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      const task2 = result.data.tasks.find(t => t.uid === "2");
      expect(task2?.name).toBe("Survey & Stake Out");
      const task3 = result.data.tasks.find(t => t.uid === "3");
      expect(task3?.name).toBe("Clearing & Grubbing");
    });

    it("should parse predecessor links with supplemental fields", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      const task3 = result.data.tasks.find(t => t.uid === "3");
      expect(task3?.predecessorLinks).toHaveLength(1);
      expect(task3?.predecessorLinks[0].predecessorUID).toBe("2");
      expect(task3?.predecessorLinks[0].type).toBe("1");
      expect(task3?.predecessorLinks[0].linkLag).toBe("0");
    });

    it("should parse lag values from realistic export", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      const task4 = result.data.tasks.find(t => t.uid === "4");
      expect(task4?.predecessorLinks).toHaveLength(1);
      expect(task4?.predecessorLinks[0].linkLag).toBe("4800");
    });

    it("should parse constraint type and date from realistic export", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      const task2 = result.data.tasks.find(t => t.uid === "2");
      expect(task2?.constraintType).toBe("2");
      expect(task2?.constraintDate).toBe("2026-02-01T08:00:00");
    });

    it("should extract all resources including UID 0 placeholder", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      // 3 resources: UID 0 (placeholder), 1, 2
      expect(result.data.resources).toHaveLength(3);
      expect(result.data.resources[0].uid).toBe("0");
      expect(result.data.resources[1].name).toBe("Survey Crew");
      expect(result.data.resources[2].name).toBe("Heavy Equipment Operator");
      expect(result.data.resources[2].maxUnits).toBe("3.00");
    });

    it("should extract all assignments with units", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      expect(result.data.assignments).toHaveLength(2);
      expect(result.data.assignments[0].taskUID).toBe("2");
      expect(result.data.assignments[0].resourceUID).toBe("1");
      expect(result.data.assignments[0].units).toBe("1");
      expect(result.data.assignments[1].taskUID).toBe("3");
      expect(result.data.assignments[1].units).toBe("2");
    });

    it("should handle BOM-prefixed realistic MSP export", () => {
      const result = parseMspXml("\uFEFF" + REALISTIC_MSP_XML);
      expect(result.errors).toHaveLength(0);
      expect(result.data.tasks.length).toBeGreaterThan(0);
    });

    it("should produce zero warnings on well-formed realistic export", () => {
      const result = parseMspXml(REALISTIC_MSP_XML);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
