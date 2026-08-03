-- Keep extension-backed functions callable from SECURITY DEFINER functions
-- that deliberately set search_path to the empty string.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION "gw_ledger".sha256(
  input BYTEA
) RETURNS BYTEA AS $$
  SELECT public.digest(input, 'sha256');
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "gw_ledger".canonical_hash(
  type_tag INTEGER,
  payload BYTEA
) RETURNS BYTEA AS $$
  SELECT public.digest(
    "gw_ledger".canonical_encode(type_tag, payload),
    'sha256'
  );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
