# ADR-0003: Encrypted Google Drive backups

- **Status:** Accepted
- **Date:** 2026-11-14
- **Decision owners:** LumaPOS product owner
- **Supersedes:** Backup destination in [ADR-0002](0002-self-hosted-postgresql-nextjs.md), decision 11

## Context

The self-hosted backup worker originally required an external disk mounted on
the host. The product owner has selected Google Drive as the complete
replacement for that disk. The backup archive must remain usable on the store
Mac and later on a VPS without changing PostgreSQL schema or backend behavior.

## Decision

1. Google Drive is the sole self-hosted backup destination. The external disk is
   no longer a prerequisite for backup readiness or cutover.
2. The worker keeps the existing archive format: PostgreSQL custom dump and
   local media packaged with a manifest, encrypted with AES-256-GCM. The local
   staging directory is temporary, private (`0700`), outside the app and media
   trees, and never counts as a successful backup.
3. Rclone transfers a uniquely named archive to a dedicated Google Drive folder.
   Use resumable upload, verify remote size and MD5 before recording success,
   and retain the archive SHA-256 in PostgreSQL/admin status. Restore downloads
   to private staging and verifies SHA-256, AES-GCM authentication, and each
   manifest file before changing an empty database/media target.
4. Use OAuth for a dedicated Google user account with a dedicated OAuth client
   and the narrow `drive.file` scope where supported. The app creates and owns
   the backup folder/files. Do not use a Google service account with personal
   Gmail storage; service accounts need an eligible Workspace Shared Drive or
   user impersonation.
5. Store the OAuth config under the service account with mode `0600`. Keep the
   AES encryption key outside Drive and outside the archive. Never expose a
   public Drive link or include credentials in the database backup.
6. Readiness requires an accessible configured Drive remote and a recent
   archive verified against remote size/hash within 26 hours. If Drive is
   unavailable, the worker fails closed; local staging is not a fallback
   destination.
7. Do not automatically delete Drive archives. Retention and account quota must
   be agreed before go-live. Use copy operations, never a mirror operation that
   can delete destination archives.
8. Moving from Mac to VPS changes only the staging path and OAuth configuration;
   it preserves the archive format, object key namespace, encryption key, and
   restore procedure.

## Consequences

- The backup worker, readiness check, restore command, admin blocker labels, and
  Mac/VPS operations docs must use the Google Drive destination contract.
- A backup depends on Internet access, Google account status, OAuth validity,
  API availability, and Drive quota. Readiness will fail when the remote archive
  is missing or cannot be verified.
- OAuth refresh credentials are a high-value secret. Protect the rclone config
  separately from encrypted archives and reauthorize securely when moving hosts.
- The Drive account is the only backup destination until a second copy is
  explicitly selected. Loss of the Drive account or encryption key can prevent
  recovery; keep the AES key independently recoverable.
- Existing encrypted rehearsal archives on the Mac remain local rehearsal
  artifacts. They are not treated as production backups and are not automatically
  uploaded or deleted.

## Go-live gates

- Configure a dedicated OAuth client/account and protected rclone config on the
  Mac; confirm remote folder access without printing credentials.
- Upload a new encrypted rehearsal archive, verify remote size/hash, download it,
  restore it to empty database/media targets, and reconcile the restored data.
- Confirm account quota and agree a retention process before enabling the
  primary database gate.
- Repeat upload/download/restore after moving to VPS using the same archive and
  encryption key before retiring the Mac copy.
