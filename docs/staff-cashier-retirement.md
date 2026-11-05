# Staff, role administration and cashier-switch retirement

LumaPOS now removes customer-facing staff management, role/permission matrix,
staff invitation and cashier/PIN switching. Historical records are preserved.

- Web settings no longer renders the Staff tab or role matrix; staff mutation
  server actions are removed.
- Mobile APIs no longer issue staff invitations, change staff roles/status,
  reset PINs, accept invitations or issue cashier context tokens.
- Legacy reads return empty arrays for existing mobile app compatibility.
- The mobile permissions contract stays active: authentication, tenant
  boundaries and access control are *security*, not the retired admin UI.
- Keep `profiles`, existing cashier/shift payment history, PIN columns,
  audit logs, mobile offline actor identities and verifier code until a tested
  archival migration. Dropping them now could strand offline outbox records.
- Do not automatically grant old manager/staff accounts owner rights.
- Cash payments, QR, credit, stock, reports and cashbook are unchanged.

Acceptance checks: owner auth on web/iOS, POS payments including offline
queue/replay, inventory and reports, and retired API denial. Build and
simulator tests must pass before separately removing legacy DB columns.
