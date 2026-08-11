CREATE SEQUENCE hestia.agent_record_verification_sequence AS bigint;

CREATE TABLE hestia.environment_signer (
  environment_id text NOT NULL CHECK (length(environment_id) BETWEEN 1 AND 256),
  key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (environment_id, key_root),
  CHECK ((status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX environment_signer_one_active_idx
  ON hestia.environment_signer (environment_id)
  WHERE status = 'active';

CREATE TABLE hestia.agent_record_verification (
  sequence bigint PRIMARY KEY CHECK (sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  record_kind text NOT NULL,
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  signer_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  signature_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  environment_id text NOT NULL,
  environment_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  environment_signature_root bytea REFERENCES gw_ledger."Cell"(hash),
  signed_receipt_root bytea UNIQUE REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('pending-signature', 'verified')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at timestamptz,
  CHECK ((status = 'pending-signature'
          AND environment_signature_root IS NULL
          AND signed_receipt_root IS NULL
          AND verified_at IS NULL)
      OR (status = 'verified'
          AND environment_signature_root IS NOT NULL
          AND signed_receipt_root IS NOT NULL
          AND verified_at IS NOT NULL)),
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root)
);

CREATE FUNCTION hestia.agent_record_roles(p_kind text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'profile/version' THEN
      ARRAY['profile-id','sequence','previous-profile','name','profile-kind',
            'root-key','operational-key','delegation']::text[]
    WHEN 'profile/key-delegation' THEN
      ARRAY['delegation-id','issuer-profile','issuer-key','subject-key',
            'subject-public-key','purposes','scope','valid-from','valid-until',
            'revocation']::text[]
    WHEN 'room/version' THEN
      ARRAY['room-id','sequence','previous-room','host-profile','policy','kernel',
            'acceptance-mode']::text[]
    WHEN 'room/invitation' THEN
      ARRAY['invite-id','room','host-profile-id','host-profile','role','purposes',
            'expires-at','capability-commitment','one-time']::text[]
    WHEN 'room/admission-proof' THEN
      ARRAY['proof-id','invitation','invite-id','room','guest-profile-id',
            'guest-profile','guest-key','capability-proof']::text[]
    WHEN 'room/membership' THEN
      ARRAY['room','member-profile','role','purposes','status','joined-epoch',
            'revoked-epoch','delegation']::text[]
    WHEN 'room/message' THEN
      ARRAY['message-id','room','membership-epoch','sender-profile','sent-at','iv',
            'ciphertext','ciphertext-root']::text[]
    WHEN 'room/message-intent' THEN
      ARRAY['room','membership-epoch','sender-profile','envelope','ciphertext',
            'delivery-policy']::text[]
    WHEN 'document/version' THEN
      ARRAY['document-id','version','previous-version','content','media-type',
            'author-profile','created-at']::text[]
    WHEN 'room/document-attachment' THEN
      ARRAY['room','document','document-policy','attached-by']::text[]
    WHEN 'negotiation/offer' THEN
      ARRAY['offer-id','room','terms','offered-by','supersedes','valid-until',
            'authority']::text[]
    WHEN 'negotiation/acceptance' THEN
      ARRAY['offer','accepted-by','human-approval','accepted-at','authority']::text[]
    WHEN 'ledger/signed-record' THEN
      ARRAY['body','signer-key','signature']::text[]
    WHEN 'ledger/verification-receipt' THEN
      ARRAY['record','body','signer-key','environment-key','outcome','sequence']::text[]
    WHEN 'ledger/admission-receipt' THEN
      ARRAY['previous-state','event','policy','kernel','result-state','effect-plan',
            'record','outcome','sequence']::text[]
    ELSE NULL
  END
$$;

CREATE FUNCTION hestia.agent_record_submittable(p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_kind = ANY (ARRAY[
    'profile/version',
    'profile/key-delegation',
    'room/version',
    'room/invitation',
    'room/admission-proof',
    'room/membership',
    'room/message',
    'room/message-intent',
    'document/version',
    'room/document-attachment',
    'negotiation/offer',
    'negotiation/acceptance'
  ]::text[])
$$;

CREATE FUNCTION hestia.hcv1_put(p_type_tag integer, p_payload bytea)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_root bytea;
BEGIN
  v_root := gw_ledger.canonical_hash(p_type_tag, p_payload);
  PERFORM gw_ledger.cell_put(v_root, 1, p_type_tag, p_payload);
  RETURN v_root;
END;
$$;

CREATE FUNCTION hestia.hcv1_blob_put(p_payload bytea)
RETURNS bytea
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT hestia.hcv1_put(6, p_payload)
$$;

CREATE FUNCTION hestia.hcv1_string_put(p_value text)
RETURNS bytea
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT hestia.hcv1_put(5, convert_to(p_value, 'UTF8'))
$$;

CREATE FUNCTION hestia.hcv1_integer_put(p_value bigint)
RETURNS bytea
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT hestia.hcv1_put(2, convert_to(p_value::text, 'UTF8'))
$$;

CREATE FUNCTION hestia.agent_record_put(p_kind text, p_roots bytea[])
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_roles text[];
  v_payload_text text;
  v_payload bytea;
  v_root bytea;
  v_index integer;
BEGIN
  v_roles := hestia.agent_record_roles(p_kind);
  IF v_roles IS NULL THEN
    RAISE EXCEPTION 'unknown Hestia agent record kind: %', p_kind;
  END IF;
  IF cardinality(v_roles) <> cardinality(p_roots) THEN
    RAISE EXCEPTION 'Hestia agent record field count mismatch for %', p_kind;
  END IF;

  v_payload_text := 'R:hestia-agent/0-alpha:' || p_kind || ':1:'
                    || cardinality(p_roots)::text || ':';
  FOR v_index IN 1..cardinality(p_roots) LOOP
    IF p_roots[v_index] IS NULL OR octet_length(p_roots[v_index]) <> 32 THEN
      RAISE EXCEPTION 'invalid HCV0 child root at position % for %', v_index - 1, p_kind;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_roots[v_index]) THEN
      RAISE EXCEPTION 'missing HCV0 child cell at position % for %', v_index - 1, p_kind;
    END IF;
    v_payload_text := v_payload_text || encode(p_roots[v_index], 'hex');
  END LOOP;

  v_payload := convert_to(v_payload_text, 'UTF8');
  v_root := hestia.hcv1_put(14, v_payload);
  FOR v_index IN 1..cardinality(p_roots) LOOP
    PERFORM gw_ledger.cell_ref_put(
      v_root,
      v_index - 1,
      v_roles[v_index],
      p_roots[v_index]
    );
  END LOOP;
  RETURN v_root;
END;
$$;

CREATE FUNCTION hestia.agent_record_validate_body(
  p_kind text,
  p_body_root bytea
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_roles text[];
  v_payload bytea;
  v_expected text;
  v_child bytea;
  v_index integer;
  v_ref_count integer;
BEGIN
  v_roles := hestia.agent_record_roles(p_kind);
  IF v_roles IS NULL OR NOT hestia.agent_record_submittable(p_kind) THEN
    RAISE EXCEPTION 'unsupported submitted Hestia agent record kind: %', p_kind;
  END IF;
  IF gw_ledger.cell_type_tag(p_body_root) <> 14 THEN
    RAISE EXCEPTION 'agent record body is not an HCV0 record';
  END IF;

  SELECT payload INTO STRICT v_payload
    FROM gw_ledger."Cell"
   WHERE hash = p_body_root;
  v_ref_count := jsonb_array_length(gw_ledger.cell_ref_entries(p_body_root));
  IF v_ref_count <> cardinality(v_roles) THEN
    RAISE EXCEPTION 'agent record body reference count mismatch for %', p_kind;
  END IF;

  v_expected := 'R:hestia-agent/0-alpha:' || p_kind || ':1:'
                || cardinality(v_roles)::text || ':';
  FOR v_index IN 1..cardinality(v_roles) LOOP
    v_child := gw_ledger.cell_ref_child(
      p_body_root,
      v_index - 1,
      v_roles[v_index]
    );
    IF NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = v_child) THEN
      RAISE EXCEPTION 'agent record body references a missing child';
    END IF;
    v_expected := v_expected || encode(v_child, 'hex');
  END LOOP;

  IF v_payload <> convert_to(v_expected, 'UTF8') THEN
    RAISE EXCEPTION 'agent record body payload/reference mismatch for %', p_kind;
  END IF;
END;
$$;

CREATE FUNCTION hestia.environment_signer_register(
  p_environment_id text,
  p_public_key bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key_root bytea;
  v_existing hestia.environment_signer%ROWTYPE;
BEGIN
  IF p_environment_id IS NULL OR length(p_environment_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'invalid Hestia environment identifier';
  END IF;
  IF p_public_key IS NULL OR octet_length(p_public_key) <> 32 THEN
    RAISE EXCEPTION 'Hestia environment signer must be a 32-byte Ed25519 public key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_environment_id, 0));
  v_key_root := hestia.hcv1_blob_put(p_public_key);
  SELECT * INTO v_existing
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND status = 'active';

  IF FOUND THEN
    IF v_existing.key_root <> v_key_root THEN
      RAISE EXCEPTION 'Hestia environment already has another active signer';
    END IF;
    RETURN v_key_root;
  END IF;

  INSERT INTO hestia.environment_signer (
    environment_id, key_root, public_key, status
  ) VALUES (
    p_environment_id, v_key_root, p_public_key, 'active'
  );
  RETURN v_key_root;
END;
$$;

CREATE FUNCTION hestia.agent_record_verify_prepare(
  p_environment_id text,
  p_pack bytea,
  p_cell_count bigint,
  p_signed_record_root bytea,
  p_record_kind text
)
RETURNS TABLE (
  sequence bigint,
  body_root bytea,
  signer_key_root bytea,
  verification_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_body_root bytea;
  v_signer_key_root bytea;
  v_signature_root bytea;
  v_signer_public_key bytea;
  v_signature bytea;
  v_signed_payload bytea;
  v_expected_signed text;
  v_outcome_root bytea;
  v_sequence_root bytea;
  v_receipt_root bytea;
  v_sequence bigint;
BEGIN
  IF p_pack IS NULL OR octet_length(p_pack) > 1000000 THEN
    RAISE EXCEPTION 'HCP0 agent pack exceeds the admission bound';
  END IF;
  IF p_cell_count IS NULL OR p_cell_count < 1 OR p_cell_count > 128 THEN
    RAISE EXCEPTION 'HCP0 agent cell count is outside the admission bound';
  END IF;
  IF NOT hestia.agent_record_submittable(p_record_kind) THEN
    RAISE EXCEPTION 'unsupported submitted Hestia agent record kind: %', p_record_kind;
  END IF;

  SELECT * INTO v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hestia environment has no active signing key';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(encode(p_signed_record_root, 'hex'), 0)
  );
  SELECT * INTO v_existing
    FROM hestia.agent_record_verification
   WHERE signed_record_root = p_signed_record_root;
  IF FOUND THEN
    IF v_existing.record_kind <> p_record_kind
       OR v_existing.environment_id <> p_environment_id THEN
      RAISE EXCEPTION 'agent record verification identity conflict';
    END IF;
    sequence := v_existing.sequence;
    body_root := v_existing.body_root;
    signer_key_root := v_existing.signer_key_root;
    verification_receipt_root := v_existing.verification_receipt_root;
    receipt_signing_payload := convert_to(
      'GWAR0:ledger/verification-receipt:'
      || encode(v_existing.verification_receipt_root, 'hex'),
      'UTF8'
    );
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT gw_ledger.snapshot_pack_import(p_pack, p_cell_count) THEN
    RAISE EXCEPTION 'HCP0 agent pack import failed';
  END IF;
  IF gw_ledger.cell_type_tag(p_signed_record_root) <> 14 THEN
    RAISE EXCEPTION 'submitted root is not an HCV0 signed record';
  END IF;
  IF jsonb_array_length(gw_ledger.cell_ref_entries(p_signed_record_root)) <> 3 THEN
    RAISE EXCEPTION 'signed record must contain exactly three references';
  END IF;

  v_body_root := gw_ledger.cell_ref_child(p_signed_record_root, 0, 'body');
  v_signer_key_root := gw_ledger.cell_ref_child(p_signed_record_root, 1, 'signer-key');
  v_signature_root := gw_ledger.cell_ref_child(p_signed_record_root, 2, 'signature');
  v_expected_signed := 'R:hestia-agent/0-alpha:ledger/signed-record:1:3:'
                       || encode(v_body_root, 'hex')
                       || encode(v_signer_key_root, 'hex')
                       || encode(v_signature_root, 'hex');
  SELECT payload INTO STRICT v_signed_payload
    FROM gw_ledger."Cell"
   WHERE hash = p_signed_record_root;
  IF v_signed_payload <> convert_to(v_expected_signed, 'UTF8') THEN
    RAISE EXCEPTION 'signed record payload/reference mismatch';
  END IF;

  PERFORM hestia.agent_record_validate_body(p_record_kind, v_body_root);
  IF gw_ledger.cell_type_tag(v_signer_key_root) <> 6
     OR gw_ledger.cell_type_tag(v_signature_root) <> 6 THEN
    RAISE EXCEPTION 'signed record key and signature must be HCV0 blob cells';
  END IF;
  SELECT payload INTO STRICT v_signer_public_key
    FROM gw_ledger."Cell"
   WHERE hash = v_signer_key_root;
  SELECT payload INTO STRICT v_signature
    FROM gw_ledger."Cell"
   WHERE hash = v_signature_root;
  IF octet_length(v_signer_public_key) <> 32 OR octet_length(v_signature) <> 64 THEN
    RAISE EXCEPTION 'invalid Ed25519 key or signature width';
  END IF;
  IF NOT gw_ledger.signature_verify(
    v_signature,
    convert_to('GWAR0:' || p_record_kind || ':' || encode(v_body_root, 'hex'), 'UTF8'),
    v_signer_public_key
  ) THEN
    RAISE EXCEPTION 'invalid GWAR0 agent record signature';
  END IF;

  v_sequence := nextval('hestia.agent_record_verification_sequence'::regclass);
  v_outcome_root := hestia.hcv1_string_put('signature-verified');
  v_sequence_root := hestia.hcv1_integer_put(v_sequence);
  v_receipt_root := hestia.agent_record_put(
    'ledger/verification-receipt',
    ARRAY[
      p_signed_record_root,
      v_body_root,
      v_signer_key_root,
      v_environment.key_root,
      v_outcome_root,
      v_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_record_verification (
    sequence,
    signed_record_root,
    record_kind,
    body_root,
    signer_key_root,
    signature_root,
    environment_id,
    environment_key_root,
    verification_receipt_root,
    status
  ) VALUES (
    v_sequence,
    p_signed_record_root,
    p_record_kind,
    v_body_root,
    v_signer_key_root,
    v_signature_root,
    p_environment_id,
    v_environment.key_root,
    v_receipt_root,
    'pending-signature'
  );

  sequence := v_sequence;
  body_root := v_body_root;
  signer_key_root := v_signer_key_root;
  verification_receipt_root := v_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR0:ledger/verification-receipt:' || encode(v_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_record_verify_commit(
  p_environment_id text,
  p_signed_record_root bytea,
  p_environment_signature bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_signing_payload bytea;
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_record_verification
   WHERE signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent record has not been prepared for verification';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'agent record was prepared for another environment';
  END IF;
  IF v_row.status = 'verified' THEN
    RETURN v_row.signed_receipt_root;
  END IF;

  SELECT * INTO v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = v_row.environment_key_root
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepared Hestia environment signer is no longer active';
  END IF;
  IF p_environment_signature IS NULL
     OR octet_length(p_environment_signature) <> 64 THEN
    RAISE EXCEPTION 'Hestia verification receipt requires a 64-byte Ed25519 signature';
  END IF;

  v_signing_payload := convert_to(
    'GWAR0:ledger/verification-receipt:'
    || encode(v_row.verification_receipt_root, 'hex'),
    'UTF8'
  );
  IF NOT gw_ledger.signature_verify(
    p_environment_signature,
    v_signing_payload,
    v_environment.public_key
  ) THEN
    RAISE EXCEPTION 'invalid Hestia environment receipt signature';
  END IF;

  v_signature_root := hestia.hcv1_blob_put(p_environment_signature);
  v_signed_receipt_root := hestia.agent_record_put(
    'ledger/signed-record',
    ARRAY[
      v_row.verification_receipt_root,
      v_row.environment_key_root,
      v_signature_root
    ]::bytea[]
  );

  UPDATE hestia.agent_record_verification
     SET environment_signature_root = v_signature_root,
         signed_receipt_root = v_signed_receipt_root,
         status = 'verified',
         verified_at = clock_timestamp()
   WHERE signed_record_root = p_signed_record_root;

  RETURN v_signed_receipt_root;
END;
$$;

REVOKE ALL ON hestia.environment_signer FROM PUBLIC;
REVOKE ALL ON hestia.agent_record_verification FROM PUBLIC;
REVOKE ALL ON SEQUENCE hestia.agent_record_verification_sequence FROM PUBLIC;

REVOKE ALL ON FUNCTION hestia.agent_record_roles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_record_submittable(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_put(integer, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_blob_put(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_string_put(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_integer_put(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_record_put(text, bytea[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_record_validate_body(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.environment_signer_register(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_record_verify_prepare(text, bytea, bigint, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_record_verify_commit(text, bytea, bytea) FROM PUBLIC;

GRANT SELECT ON hestia.environment_signer TO hestia_app;
GRANT SELECT ON hestia.agent_record_verification TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_record_verify_prepare(text, bytea, bigint, bytea, text) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_record_verify_commit(text, bytea, bytea) TO hestia_app;

COMMENT ON TABLE hestia.agent_record_verification IS
  'Projection of HCP0-imported, GWAR0-verified agent records and Hestia-signed verification receipts.';
COMMENT ON FUNCTION hestia.agent_record_verify_prepare(text, bytea, bigint, bytea, text) IS
  'Imports bounded HCP0 cells, validates native HCV0 structure, verifies the agent Ed25519 signature, and returns exact environment receipt signing bytes.';
COMMENT ON FUNCTION hestia.agent_record_verify_commit(text, bytea, bytea) IS
  'Verifies an operator-provisioned Hestia environment signature and commits the signed verification receipt as native HCV0 cells.';
