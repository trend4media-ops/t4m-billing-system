# T4M Hyper Smart Platform (Admin, Managers, Creators)

This document is a quick orientation for developers and operators. It summarizes the core modules, latest changes, and the testing requirements. Keep this file updated when making structural changes.

## What was just added

- Events Admin UI now shows attendance counts and provides an attendance editor per event (toggle per creator). Backend endpoints for attendance exist under `/api/admin/events/:id/attendance`.
- Creator CRM Admin UI now fetches task lists, allows creating tasks, and marking tasks as done. Added a Monthly Target editor per creator with month selector.
- Reports page now includes a small "Targets Overview" (creators with set NET goals) and an "Attendance Summary" widget.
- Frontend API client (`src/lib/api.ts`) extended:
  - `targetsApi.listByMonth(month)` to fetch all monthly targets
  - `eventsApi.getAttendance(id)`, `eventsApi.setAttendance(id, creatorId, attended)`
  - `creatorsApi.listTasks(id)`
- Backend (`functions/src/routes/admin.ts`) contains:
  - Targets endpoints: `GET /api/admin/targets`, `POST /api/admin/targets`
  - Events: CRUD, notify, and attendance endpoints
  - Creators: CRUD, docs upload, tasks CRUD

## Quality gates (must be geprüft und getestet at every step)

Every change must satisfy the following before merging or deploying:

1. Build green
   - `cd functions && npm run build`
   - `cd trend4media-frontend && npm run build`

2. Lint/tests green (if applicable)
   - Add/extend tests where logic changes.

3. Manual verification per module
   - Settings/Commission
     - Preview for a given month returns results.
     - Apply creates `manualAdjustments`, updates `manager-earnings`, and sends `SETTINGS_APPLY` messages.
     - Payout requests are blocked if `SETTINGS_APPLY` not acknowledged for period.
   - Events
     - Create, list, update, delete events.
     - Notify sends messages.
     - Attendance: counts load and toggling persists.
   - Creator CRM
     - Create/list/get/update/delete creators.
     - Docs upload lists and opens files.
     - Tasks: create/list/update; state transitions reflected in UI.
     - Targets: set/get per creator; overview in Reports updates.
   - Reports
     - Selected month loads data; CSV export works.
     - Targets Overview and Attendance Summary visible and correct.
   - Branding/White-label
     - Branding changes (name, logo, colors, dark mode) persist and reflect across pages.

4. Performance
   - Pages render in <2s on warm cache; avoid N+1 requests. Batch where possible.

5. Data safety
   - Destructive actions gated by confirmation; Firestore batch/transactions used where needed.

## Developer quick links

- Backend routes:
  - `functions/src/routes/admin.ts`
  - `functions/src/routes/api.ts`
- Core services:
  - `functions/src/services/commissionConfig.ts`
- Frontend:
  - `trend4media-frontend/src/app/admin/...`
  - `trend4media-frontend/src/lib/api.ts`
  - `trend4media-frontend/src/contexts/BrandingContext.tsx`

## Roadmap (short)

- Reports: include per-creator targets and attendance in CSV.
- Finance: SEPA CSV export for paid payouts.
- White-label: agency presets (branding + locale/currency), multi-tenant switcher. 