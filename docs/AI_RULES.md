# Planning OS - AI Rules (Non-Negotiable)
1) React UI is dumb: it renders only. No schedule state logic in React.
2) Web Worker owns all state and returns DIFF updates.
3) Never serialize large schedule data with JSON.stringify/parse.
4) Never render Gantt bars with DOM divs; Canvas/WebGL only (later).
5) Keep changes small and testable. Prefer typed message contracts.
