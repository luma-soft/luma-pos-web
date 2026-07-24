-- A restored/imported auth.refresh_tokens table can leave its identity sequence
-- behind MAX(id). GoTrue then fails new sign-ins with "Database error granting user"
-- when it tries to insert a refresh token using an already occupied primary key.
SELECT setval(
  pg_get_serial_sequence('auth.refresh_tokens', 'id'),
  COALESCE((SELECT MAX(id) FROM auth.refresh_tokens), 1),
  EXISTS (SELECT 1 FROM auth.refresh_tokens)
);
