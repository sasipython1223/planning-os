#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${WEB_DIR}/src/features/car-finder/reports/top5-cars-by-copilot-ranking.md"

cd "${WEB_DIR}"
CAR_FINDER_WRITE_REPORT=1 ./node_modules/.bin/vitest run src/features/car-finder/__tests__/top5RankingOutput.test.ts --reporter=verbose

echo ""
echo "Generated report: ${REPORT_PATH}"
