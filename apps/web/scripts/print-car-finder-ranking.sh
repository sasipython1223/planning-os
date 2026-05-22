#!/usr/bin/env bash
set -euo pipefail

cd /home/runner/work/planning-os/planning-os/apps/web

CAR_FINDER_WRITE_REPORT=1 ./node_modules/.bin/vitest run src/features/car-finder/__tests__/top5RankingOutput.test.ts --reporter=verbose

echo ""
echo "Generated report: /home/runner/work/planning-os/planning-os/apps/web/src/features/car-finder/reports/top5-cars-by-copilot-ranking.md"
