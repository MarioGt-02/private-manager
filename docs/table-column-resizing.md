# Table column resizing

- Drag the visible handle on the right edge of any data-column header to widen or narrow that column. Mouse, pen and touch use Pointer Events with capture.
- Resizing freezes the measured data-column widths; other columns do not redistribute when the target width changes. A fixed-layout `colgroup` aligns headers and cells. The row-action column remains fixed.
- Focus the handle and use Left/Right for 10px steps, Shift+Left/Right for 40px steps. Double-click or Home restores that column's type-based default. **Reset column widths** restores responsive automatic layout for the whole table.
- Widths are bounded to 56–1600px and stored by table ID and column ID in this browser's localStorage. They survive reloads and reopening, follow reordered/renamed columns, and are isolated between tables. They do not sync across browsers/devices and require no database migration.
- Preferences load after hydration; unavailable or malformed storage does not prevent resizing. Cancelled drags restore the previous widths. Presentation resizing also works for archived/read-only tables and does not change records or call AI/API endpoints.
- Wide tables scroll within the existing table viewport rather than stretching the Object workspace.

Validation: `tests/table-column-widths.test.ts` covers storage sanitization, bounds and accessible handles. `tests/table-resize.browser.mjs` uses real components and production CSS with fixture data at 1440/390px to cover independent pointer resize, persistence, reorder/remount, keyboard/reset, real touch/cancellation, editable cells, column menus, read-only tables, isolation and overflow. Supply `PLAYWRIGHT_MODULE` and `UI_SCREENSHOT_DIR`, and run after `npm run build`.