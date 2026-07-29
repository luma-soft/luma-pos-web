# LumaPOS Field Service Platform — Technical Design

**Date:** 2026-07-29  
**Status:** Approved for implementation  
**Source:** `../../../../document/lumapos/LUMAPOS_CAMERA_PROJECT_MANAGEMENT_REVIEW.md`

## Outcome

LumaPOS becomes the system of record for camera installation and after-sales
service. A technician can receive, execute, document, and complete assigned work
from the Flutter app. Managers can dispatch teams, monitor SLA and maintenance,
and review a complete evidence trail. Camera vendor systems remain responsible
for video, firmware, device configuration, and customer device ownership.

## Product Boundary

LumaPOS owns:

- customers, sites, quotes, jobs, schedules, crew, and checklists;
- material reservations and actual usage;
- installed asset identity, location, warranty, and service history;
- visits, time entries, photos, documents, signatures, and audit events;
- maintenance generation, warranty intake, SLA, notifications, and reporting;
- read-only projections of vendor health and alerts.

Vendor platforms own:

- live view and playback;
- firmware and remote device configuration;
- camera credentials and verification codes;
- account transfer and customer viewing permissions;
- authoritative device health and alert streams.

## Users and Access

### Technician

A `technician` role is added to the shared role model. Technicians may:

- view only jobs where they are the primary assignee or a crew member;
- view the minimum customer/site information required to perform that job;
- update safe field states, checklist items, visit/time data, actual material
  usage, attachments, installed assets, completion notes, and signatures;
- create warranty requests for assets on an assigned project.

Technicians may not view product cost, project margin, cashbook, settings,
unrelated customers/projects, or modify commercial documents.

### Manager and owner

Managers and owners retain full service access, including dispatch, SLA,
maintenance, costs, profitability, vendor connections, and all project jobs.

### Customer

Customers use a scoped, expiring portal token to submit a warranty/service
request and view only the status of that request. Tokens never grant general
project access.

## Data Model

The existing `projects`, `service_jobs`, `service_job_materials`,
`installed_assets`, `warranty_claims`, `service_handover_documents`, and
`service_maintenance_plans` tables remain canonical.

New operational tables:

- `service_job_assignments`: primary/crew assignment and assignment history;
- `service_visits`: check-in/out, coarse coordinates, and visit state;
- `service_time_entries`: work/travel time with server timestamps;
- `service_attachments`: private storage metadata, evidence category, and owner;
- `service_signatures`: signer identity, signature storage path, document hash,
  and signing evidence;
- `service_job_events`: append-only normalized timeline;
- `service_maintenance_occurrences`: idempotent generation per plan/due date;
- `service_customer_requests`: token-scoped service/warranty intake and SLA;
- `service_sla_policies`: priority-based response/resolution targets;
- `camera_vendor_connections`: server-side connection metadata without secrets;
- `camera_device_links`: mapping from installed assets to vendor identifiers;
- `camera_health_snapshots`: read-only health projection;
- `camera_device_alerts`: normalized vendor alerts;
- `camera_sync_runs`: observable sync history.

Every new public table has RLS enabled and denies direct `anon` and
`authenticated` access. The application accesses these records through
authenticated server APIs and its server database connection. Private
attachments are uploaded by an authenticated server route; no service-role key
is exposed to web or Flutter clients.

## Core Flows

### Field job

1. Manager schedules a job and assigns a primary technician or crew.
2. Technician sees the job in Today/Week only if assigned.
3. Check-in starts a visit and work timer; pause/end records server time.
4. Technician completes checklist, records actual material, scans asset
   serial/QR, and uploads categorized before/after evidence.
5. Customer signs the handover snapshot. The server hashes the immutable
   document payload and stores signature evidence privately.
6. Completion validates required checklist/evidence/signature rules, completes
   the job, emits timeline/audit events, and re-derives project stage.

### Maintenance

The existing protected notification cron invokes a maintenance worker. For each
active plan within the lead window, it atomically creates one occurrence and one
service job. A unique `(plan_id, due_on)` constraint makes retries idempotent.
The assigned technician and managers receive notifications. Overdue occurrences
are escalated without generating duplicate jobs.

### Warranty/customer request

A manager creates an expiring portal link scoped to one customer/project. The
customer submits contact details, description, priority hints, and optional
photos. The server creates a request, calculates SLA deadlines, and notifies
managers. Triage may link it to an installed asset and warranty claim/job.

### Dispatch and offline

Managers view jobs by day, status, and assignee and can assign multiple crew
members. Flutter queues only idempotent, safe field mutations with a client
mutation ID. Server uniqueness guarantees replay safety. Conflicts return the
current server version and remain visible in the sync center.

### Camera vendor integration

All integrations implement a neutral `CameraVendorAdapter`:

```ts
interface CameraVendorAdapter {
  getDeviceSummary(externalDeviceId: string): Promise<DeviceSummary>;
  getDeviceHealth(externalDeviceId: string): Promise<DeviceHealth>;
  listDeviceAlerts(externalDeviceId: string): Promise<DeviceAlert[]>;
  buildVendorAppLink(externalDeviceId: string): string | null;
}
```

The default adapter is disabled. EZVIZ is feature-flagged and server-only.
Production polling is not enabled until official partner credentials, device
authorization, API region, rate limits, and supported models are verified.
LumaPOS never guesses undocumented endpoints or stores camera passwords.

## API Shape

Service mobile APIs use the existing response envelope and bearer auth:

- `GET /api/mobile/services/jobs?scope=today|week`
- `GET /api/mobile/services/jobs/:id`
- `POST /api/mobile/services/jobs/:id/visits/check-in`
- `POST /api/mobile/services/jobs/:id/visits/check-out`
- `PATCH /api/mobile/services/jobs/:id/checklist`
- `POST /api/mobile/services/jobs/:id/attachments`
- `POST /api/mobile/services/jobs/:id/signatures`
- `POST /api/mobile/services/jobs/:id/assets`
- `POST /api/mobile/services/jobs/:id/complete`
- manager-only assignment, dispatch, SLA, maintenance, and vendor endpoints.

Every job-scoped endpoint resolves access from the authenticated profile and
server-side assignment data. A client-supplied project or assignee ID is never
accepted as proof of authorization.

## Flutter Experience

The main shell exposes `Công việc` for technicians and service-capable managers.
It contains:

- Today and Week lists with due, priority, customer, address, and status;
- a job workspace with progress, action bar, checklist, materials, assets,
  photos, timeline, and completion controls;
- QR/barcode scanning via the existing `mobile_scanner` dependency;
- photo capture via the existing `image_picker` dependency;
- an in-app signature pad implemented without sending raw biometric data;
- directions through the platform map URL;
- offline status and replay visibility through the existing sync center.

## Reliability and Security

- Server time is authoritative for assignment, visits, signatures, SLA, and
  maintenance generation.
- Mutations are transactional when they update more than one aggregate.
- Field mutations include an idempotency key and append an audit/timeline event.
- Attachments are private, MIME/size checked, path-scoped, and served by short
  signed URLs.
- Signature records include a SHA-256 hash of the signed document snapshot.
- Secrets remain in server environment/secret storage and are never returned.
- Vendor sync is read-only, rate-limited, retryable, and fully observable.
- Location is optional/coarse and requires explicit device permission.

## Delivery Slices

1. **Foundation:** technician role, assignment-aware authorization, schema,
   timeline, private evidence APIs, tests, and migration verification.
2. **Technician mobile:** Today/Week, job workspace, status/checklist/material,
   scan asset, capture evidence, signature, and completion.
3. **Proactive service:** maintenance occurrence worker, SLA, notifications,
   and customer request portal.
4. **Dispatch:** crew, visits/time, directions, idempotent offline field
   mutations, conflict surfacing, and productivity reporting.
5. **Vendor projection:** adapter contract, disabled/EZVIZ configuration,
   device mapping, health/alert persistence, sync observability, and feature
   flag. Live polling remains disabled until partner prerequisites are met.

Each slice is independently deployable and must pass focused unit/integration
tests, lint, production build, migration application, pending-migration check,
and direct schema verification before completion.

## Acceptance Criteria

- A technician cannot read or mutate an unassigned job.
- A technician can complete an assigned camera job end-to-end on Flutter.
- Required evidence is privately stored and the signed snapshot is verifiable.
- Maintenance retries produce exactly one occurrence and job per due date.
- Customer portal tokens cannot cross customer/project/request boundaries.
- Crew check-in/out and safe offline replays are idempotent.
- Managers can see dispatch, overdue SLA, job timeline, and technician metrics.
- Vendor failures never block core field-service workflows.
- No camera credential or vendor access token is exposed to clients or stored
  in ordinary business fields.
