-- The profile prepare function predates the room admission flow and returns
-- columns named profile_id and profile_sequence. Those OUT parameters are also
-- PL/pgSQL variables, so unqualified reads from hestia.agent_profile are
-- ambiguous under PostgreSQL's strict default policy.
--
-- Keep the compatibility policy scoped to this one already-defined function.
-- New admission functions continue to use the strict default and qualify their
-- projection reads explicitly.
ALTER FUNCTION hestia.agent_profile_admit_prepare(text, bytea)
  SET plpgsql.variable_conflict TO 'use_column';

COMMENT ON FUNCTION hestia.agent_profile_admit_prepare(text, bytea) IS
  'Prepares canonical profile admission. Function-local use_column resolves legacy RETURNS TABLE output names against explicitly selected projection columns.';
