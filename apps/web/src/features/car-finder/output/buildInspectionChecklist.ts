export function buildInspectionChecklist(): string[] {
  return [
    "Match chassis/engine numbers against paperwork.",
    "Scan ECU/OBD for hidden fault codes.",
    "Cold-start behavior, idle smoothness, and gearbox shift quality.",
    "Suspension, steering rack, and brake condition.",
    "Check for repaint, panel mismatch, and structural signs.",
    "Verify service-history continuity with invoice dates/mileage.",
    "Road-test at city and expressway speeds.",
    "For hybrids: battery health diagnostics and cooling fan condition.",
    "Confirm ADAS/safety systems are present and functioning.",
  ];
}
