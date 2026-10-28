# Supabase project switch — 2026-10-28

## Reason

The previous Supabase project exceeded the Free Plan egress allowance. The
Supabase Usage page showed 6.794 GB used against 5 GB (136%), and Supabase
restricted all services under its Fair Use Policy. Requests returned HTTP 402,
which prevented the app and website from reaching backend services. Restoring
service on that project required waiting for the next billing cycle or upgrading
the organization plan; the $25/month upgrade was not desired.

The team therefore switched to a newly created Supabase project as a temporary,
lower-cost way to restore service.

## New project

- Project ref: `awomvgzxylucxjkkmmjp`
- Project URL: `https://awomvgzxylucxjkkmmjp.supabase.co`

Do not store API keys, database passwords, or connection strings in this file.

## Recorded follow-up

- On 2026-10-28, GitHub Actions secrets `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` in `luma-soft/luma-pos-web` were updated to the new
  project.
- The `Keep Supabase Alive` workflow was run manually and completed
  successfully against the new project.

This note records the reason for the project switch. It does not by itself
confirm that database contents, Auth users, Storage objects, or every deployed
client have been migrated; track those separately when validating the cutover.

## Contingency

If the new project causes further service issues, the planned fallback is to
switch the app configuration back to the previous Supabase project. Do this
only after its quota restriction has cleared; while it is still returning HTTP
402, switching back will not restore service. Before reverting, reconcile any
records created or changed in the new project so those writes are not lost.
