-- The room admission prepare functions return convenience columns such as
-- room_id and invite_id. Those OUT parameters are also PL/pgSQL variables and
-- can shadow equally named projection columns in legacy unqualified reads.
--
-- Keep the compatibility policy scoped to the three prepare functions. Commit
-- functions and future admission code continue to use PostgreSQL's strict
-- default and should qualify projection columns explicitly.
ALTER FUNCTION hestia.agent_room_genesis_prepare(text, bytea)
  SET plpgsql.variable_conflict TO 'use_column';

ALTER FUNCTION hestia.agent_room_invitation_prepare(text, bytea)
  SET plpgsql.variable_conflict TO 'use_column';

ALTER FUNCTION hestia.agent_room_member_prepare(text, bytea, bytea)
  SET plpgsql.variable_conflict TO 'use_column';

COMMENT ON FUNCTION hestia.agent_room_genesis_prepare(text, bytea) IS
  'Prepares signed room genesis. Function-local use_column resolves legacy RETURNS TABLE output names against projection columns.';

COMMENT ON FUNCTION hestia.agent_room_invitation_prepare(text, bytea) IS
  'Prepares signed one-time invitation admission. Function-local use_column resolves legacy RETURNS TABLE output names against projection columns.';

COMMENT ON FUNCTION hestia.agent_room_member_prepare(text, bytea, bytea) IS
  'Prepares signed external-member admission. Function-local use_column resolves legacy RETURNS TABLE output names against projection columns.';
