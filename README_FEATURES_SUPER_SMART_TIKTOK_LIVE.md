# SUPER SMART TikTok LIVE Agency – Dynamic Commission & Incentives

This README explains the adaptable Abrechnungssystem (commission system), monthly FX handling, payout flow, and the new Incentives module for Admins, Managers, and Creators.

## Highlights
- Versioned commission settings with preview/lock/apply.
- Monthly FX (USD→EUR fixed on the 6th) for legacy USD components; EUR-fixed extras and downline.
- Payout requests require a PDF invoice; admin processes statuses.
- Incentives rules to reward net growth, with preview/apply workflow.

## Commission Settings (Admin)
- Page: `Admin → Settings`
- Endpoints:
  - GET `/admin/config/commission` – current active config
  - GET `/admin/config/commission/versions` – list versions
  - POST `/admin/config/commission` – create a version (name, effectiveFrom, rates)
  - POST `/admin/config/commission/:id/activate` – activate a version
  - POST `/admin/config/commission/preview` – preview deltas for a month
  - POST `/admin/config/commission/apply` – apply deltas via `manualAdjustments`
  - POST `/admin/config/commission/lock` – lock version to month
  - DELETE `/admin/config/commission/lock/:month` – unlock

Data model: `systemConfig`, `systemConfigLocks`, `systemConfigBaselines`.

## FX Handling
- Endpoint: GET `/fx/monthly?month=YYYYMM` returns `{ month, asOfDate, usdToEur }`.
- Stored in `fxRates/{YYYYMM}` using exchangerate.host rate on day 6.
- Base+Milestones are treated as USD legacy components and converted using FX; extras and downline are EUR.

## Payouts
- Manager page: `Dashboard → Payouts`
- Request requirements:
  - `period` (YYYYMM), `amount (EUR)`, `bankDetails`, PDF invoice upload.
  - Minimum available per month: 150 EUR.
- Backend stores invoice in Cloud Storage and creates `payoutRequests` entry with history.
- Admin page: `Admin → Payouts` to filter, update statuses, and view invoice link.

## Incentives (Admin)
- Page: `Admin → Incentives` (`src/app/admin/incentives/page.tsx`)
- Endpoints:
  - GET `/admin/incentives/rules` – list rules
  - POST `/admin/incentives/rules` – create `NET_GROWTH_PERCENT` rules (percent and amounts per manager type)
  - POST `/admin/incentives/preview` – preview eligible manager incentive payouts for a month
  - POST `/admin/incentives/apply` – apply incentive bonuses; writes to `bonuses` and updates `manager-earnings` extras

## Translations
- All UI text integrates with `LanguageContext` and can be localized. New keys under `incentives.*`, `payouts.*`, and `fx.*` were added.

## Operating Steps (Admin)
1. Upload Excel and process month.
2. Optionally tweak Commission Settings:
   - Preview overrides → Save version → Activate or Lock → Apply to month.
3. Manage incentives: create rule(s) → preview month → apply.
4. Review monthly overview and payouts; process payout requests.

## Notes
- Safety first: apply operations create `manualAdjustments` to keep history intact.
- Messages notify managers when commission settings are applied for a month and require acknowledgment before payout requests. 