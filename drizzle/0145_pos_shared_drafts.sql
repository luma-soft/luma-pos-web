CREATE TABLE IF NOT EXISTS pos_shared_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  draft_id text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT pos_shared_drafts_owner_profile_fk
    FOREIGN KEY (store_id, owner_user_id)
    REFERENCES profiles(store_id, id)
    ON DELETE CASCADE,
  CONSTRAINT pos_shared_drafts_id_length_check
    CHECK (length(draft_id) BETWEEN 1 AND 128),
  CONSTRAINT pos_shared_drafts_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_shared_drafts_account_id_unique
  ON pos_shared_drafts (store_id, owner_user_id, draft_id);

CREATE INDEX IF NOT EXISTS pos_shared_drafts_account_updated_idx
  ON pos_shared_drafts (store_id, owner_user_id, updated_at DESC);
