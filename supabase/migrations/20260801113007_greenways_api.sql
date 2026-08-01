-- The ledger implementation remains private. PostgREST exposes only this
-- deliberately small facade; browser clients never receive database or
-- service-role credentials.
CREATE SCHEMA IF NOT EXISTS greenways_api;

REVOKE ALL ON SCHEMA greenways_api FROM PUBLIC;
REVOKE ALL ON SCHEMA gw_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA gw_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gw_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gw_ledger FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION greenways_api.node_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'protocol', 'hestia/1',
    'ledger_schema', 'gw_ledger',
    'authenticated', auth.uid() IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION greenways_api.ledger_head(network text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN h.network IS NULL THEN NULL ELSE jsonb_build_object(
    'network', h.network,
    'height', h.height,
    'block_root', encode(h.block_root, 'hex'),
    'state_root', encode(h.state_root, 'hex'),
    'updated_at_us', h.updated_at
  ) END
  FROM (SELECT network, height, block_root, state_root, updated_at
        FROM gw_ledger."Head"
        WHERE "Head".network = ledger_head.network
        LIMIT 1) AS h;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA greenways_api FROM PUBLIC;
GRANT USAGE ON SCHEMA greenways_api TO anon, authenticated;
GRANT EXECUTE ON FUNCTION greenways_api.node_info() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION greenways_api.ledger_head(text) TO authenticated;

COMMENT ON SCHEMA greenways_api IS
  'Narrow authenticated facade for a local Greenways node.';
