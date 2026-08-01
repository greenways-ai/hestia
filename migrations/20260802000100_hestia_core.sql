CREATE SCHEMA IF NOT EXISTS hestia;
REVOKE ALL ON SCHEMA hestia FROM PUBLIC;

CREATE TABLE hestia.event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream text NOT NULL CHECK (length(stream) BETWEEN 1 AND 256),
  sequence bigint NOT NULL CHECK (sequence > 0),
  previous_hash bytea NOT NULL CHECK (octet_length(previous_hash) = 32),
  event_hash bytea NOT NULL UNIQUE CHECK (octet_length(event_hash) = 32),
  event_type text NOT NULL CHECK (event_type LIKE '@%/%'),
  actor_key text NOT NULL CHECK (length(actor_key) BETWEEN 1 AND 1024),
  payload jsonb NOT NULL,
  signature bytea NOT NULL CHECK (octet_length(signature) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (stream, sequence)
);

CREATE INDEX event_stream_created_idx ON hestia.event (stream, created_at DESC);
CREATE INDEX event_type_created_idx ON hestia.event (event_type, created_at DESC);

CREATE FUNCTION hestia.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'hestia events are append-only';
END;
$$;

CREATE TRIGGER event_no_update
BEFORE UPDATE OR DELETE ON hestia.event
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE FUNCTION hestia.append_event(
  p_stream text,
  p_event_type text,
  p_actor_key text,
  p_payload jsonb,
  p_signature bytea
)
RETURNS TABLE(sequence bigint, event_hash bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous bytea;
  v_sequence bigint;
  v_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_stream, 0));

  SELECT e.sequence, e.event_hash
    INTO v_sequence, v_previous
    FROM hestia.event AS e
   WHERE e.stream = p_stream
   ORDER BY e.sequence DESC
   LIMIT 1;

  v_sequence := COALESCE(v_sequence, 0) + 1;
  v_previous := COALESCE(v_previous, decode(repeat('00', 32), 'hex'));
  v_hash := digest(
    v_previous
    || convert_to(p_stream || ':' || v_sequence || ':' || p_event_type || ':', 'UTF8')
    || convert_to(p_actor_key, 'UTF8')
    || convert_to(p_payload::text, 'UTF8')
    || p_signature,
    'sha256'
  );

  INSERT INTO hestia.event (
    stream, sequence, previous_hash, event_hash,
    event_type, actor_key, payload, signature
  ) VALUES (
    p_stream, v_sequence, v_previous, v_hash,
    p_event_type, p_actor_key, p_payload, p_signature
  );

  RETURN QUERY SELECT v_sequence, v_hash;
END;
$$;

CREATE FUNCTION hestia.verify_stream(p_stream text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  e hestia.event%ROWTYPE;
  v_previous bytea := decode(repeat('00', 32), 'hex');
  v_expected bytea;
  v_sequence bigint := 0;
BEGIN
  FOR e IN
    SELECT * FROM hestia.event
     WHERE stream = p_stream
     ORDER BY sequence
  LOOP
    v_sequence := v_sequence + 1;
    IF e.sequence <> v_sequence OR e.previous_hash <> v_previous THEN
      RETURN false;
    END IF;
    v_expected := digest(
      v_previous
      || convert_to(e.stream || ':' || e.sequence || ':' || e.event_type || ':', 'UTF8')
      || convert_to(e.actor_key, 'UTF8')
      || convert_to(e.payload::text, 'UTF8')
      || e.signature,
      'sha256'
    );
    IF e.event_hash <> v_expected THEN
      RETURN false;
    END IF;
    v_previous := e.event_hash;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE hestia.authority (
  authority_id text PRIMARY KEY,
  operator text NOT NULL,
  public_key jsonb NOT NULL,
  jurisdiction text,
  assurance_level text NOT NULL,
  accreditation_status text NOT NULL,
  accreditation_expires_at timestamptz,
  event_hash bytea NOT NULL REFERENCES hestia.event(event_hash)
);

CREATE TABLE hestia.identity_link (
  identity_id text NOT NULL,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  controller_key text NOT NULL,
  attestation jsonb NOT NULL,
  event_hash bytea NOT NULL REFERENCES hestia.event(event_hash),
  PRIMARY KEY (identity_id, provider, provider_subject)
);

CREATE TABLE hestia.recovery_ceremony (
  ceremony_id uuid PRIMARY KEY,
  identity_id text NOT NULL,
  browser_key jsonb NOT NULL,
  policy_hash bytea NOT NULL CHECK (octet_length(policy_hash) = 32),
  threshold smallint NOT NULL CHECK (threshold > 0),
  keeper_count smallint NOT NULL CHECK (keeper_count >= threshold),
  state text NOT NULL CHECK (state IN (
    'requested', 'identity-checking', 'keeper-review', 'quorum-approved',
    'ceremony-active', 'completed', 'rejected', 'cancelled', 'expired'
  )),
  expires_at timestamptz NOT NULL,
  event_hash bytea NOT NULL REFERENCES hestia.event(event_hash)
);

CREATE TABLE hestia.recovery_approval (
  ceremony_id uuid NOT NULL REFERENCES hestia.recovery_ceremony(ceremony_id),
  keeper_id text NOT NULL REFERENCES hestia.authority(authority_id),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  envelope_hash bytea CHECK (envelope_hash IS NULL OR octet_length(envelope_hash) = 32),
  event_hash bytea NOT NULL REFERENCES hestia.event(event_hash),
  PRIMARY KEY (ceremony_id, keeper_id)
);

CREATE TABLE hestia.document_operation (
  operation_id uuid PRIMARY KEY,
  document_id text NOT NULL,
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  result_revision bigint NOT NULL CHECK (result_revision > base_revision),
  submitted_operation jsonb NOT NULL,
  transformed_operation jsonb NOT NULL,
  actor_key text NOT NULL,
  event_hash bytea NOT NULL REFERENCES hestia.event(event_hash),
  UNIQUE (document_id, result_revision)
);

CREATE INDEX document_operation_base_idx
  ON hestia.document_operation (document_id, base_revision);

CREATE TABLE hestia.publication_receipt (
  release_id text PRIMARY KEY,
  manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest) = 32),
  edition integer NOT NULL CHECK (edition > 0),
  parent_release_id text REFERENCES hestia.publication_receipt(release_id),
  assets jsonb NOT NULL,
  actor_key text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_hash bytea NOT NULL REFERENCES hestia.event(event_hash)
);

GRANT USAGE ON SCHEMA hestia TO hestia_app;
GRANT SELECT ON ALL TABLES IN SCHEMA hestia TO hestia_app;
GRANT INSERT ON hestia.authority, hestia.identity_link,
  hestia.recovery_ceremony, hestia.recovery_approval,
  hestia.document_operation, hestia.publication_receipt TO hestia_app;
REVOKE ALL ON FUNCTION hestia.append_event(text, text, text, jsonb, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.verify_stream(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hestia.append_event(text, text, text, jsonb, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.verify_stream(text) TO hestia_app;
