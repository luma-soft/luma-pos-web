CREATE TABLE IF NOT EXISTS mobile_push_device_binding_fences (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id varchar(120) NOT NULL,
  binding_generation bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

--> statement-breakpoint

INSERT INTO mobile_push_device_binding_fences (
  user_id,
  device_id,
  binding_generation,
  active,
  updated_at
)
SELECT
  user_id,
  device_id,
  binding_generation,
  enabled,
  updated_at
FROM mobile_push_devices
ON CONFLICT (user_id, device_id) DO UPDATE
SET
  binding_generation = EXCLUDED.binding_generation,
  active = EXCLUDED.active,
  updated_at = GREATEST(
    mobile_push_device_binding_fences.updated_at,
    EXCLUDED.updated_at
  )
WHERE mobile_push_device_binding_fences.binding_generation < EXCLUDED.binding_generation;
