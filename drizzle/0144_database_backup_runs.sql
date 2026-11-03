CREATE TABLE database_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  requested_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  requested_by_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  schedule_key text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  duration_milliseconds integer CHECK (duration_milliseconds IS NULL OR duration_milliseconds >= 0),
  archive_key text,
  archive_size_bytes bigint CHECK (archive_size_bytes IS NULL OR archive_size_bytes >= 0),
  sha256 varchar(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code text
);

CREATE UNIQUE INDEX database_backup_runs_schedule_key_unique
  ON database_backup_runs (schedule_key)
  WHERE schedule_key IS NOT NULL;

CREATE UNIQUE INDEX database_backup_runs_one_active_idx
  ON database_backup_runs ((true))
  WHERE status IN ('queued', 'running');

CREATE INDEX database_backup_runs_status_requested_at_idx
  ON database_backup_runs (status, requested_at);

CREATE INDEX database_backup_runs_requested_by_idx
  ON database_backup_runs (requested_by_store_id, requested_at);
