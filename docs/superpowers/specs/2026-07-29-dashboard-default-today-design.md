# Dashboard Default Range: Today

## Goal

When a user opens the Dashboard without a valid `range` query parameter, the
Dashboard must select and load **Today**. Explicit valid range selections must
continue to work.

## Behavior

- `/dashboard` uses the `today` range.
- `/dashboard?range=today` uses the `today` range.
- `/dashboard?range=7d`, `/dashboard?range=30d`, and
  `/dashboard?range=month` continue to use their requested ranges.
- A missing or unsupported `range` value falls back to `today`.
- The selected range control on desktop and mobile reflects the effective
  range.

## Design

Change the Dashboard page's query-parameter fallback from `7d` to `today`.
Also change the default argument of `getDashboard` to `today` so callers that
omit the range get the same behavior as the page.

Do not redirect `/dashboard` to `/dashboard?range=today`; the effective default
can be resolved during server rendering without adding a navigation round trip
or rewriting the URL.

## Compatibility

No database, API, translation, or URL contract changes are required. Existing
links with an explicit valid range remain unchanged.

## Verification

- Add a focused regression test that proves the page falls back to `today` for
  missing or invalid query parameters.
- Prove the dashboard data loader defaults to `today`.
- Confirm explicit valid ranges are still preserved.
- Run the focused tests, TypeScript checks or build checks appropriate to the
  affected server-rendered page, and lint the changed files.
