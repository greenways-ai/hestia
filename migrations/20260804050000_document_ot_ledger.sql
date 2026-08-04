CREATE SEQUENCE hestia.document_record_verification_sequence AS bigint;
CREATE SEQUENCE hestia.document_import_sequence AS bigint;

CREATE TABLE hestia.document_record_verification (
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
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root),
  CHECK ((status = 'pending-signature'
          AND environment_signature_root IS NULL
          AND signed_receipt_root IS NULL
          AND verified_at IS NULL)
      OR (status = 'verified'
          AND environment_signature_root IS NOT NULL
          AND signed_receipt_root IS NOT NULL
          AND verified_at IS NOT NULL))
);

CREATE TABLE hestia.document_head (
  document_id text PRIMARY KEY CHECK (length(document_id) BETWEEN 1 AND 512),
  current_revision bigint NOT NULL CHECK (current_revision >= 0),
  current_revision_root bytea REFERENCES gw_ledger."Cell"(hash),
  current_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  origin_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  environment_id text NOT NULL,
  environment_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root),
  CHECK ((current_revision = 0 AND current_revision_root IS NULL)
      OR (current_revision > 0 AND current_revision_root IS NOT NULL))
);

CREATE TABLE hestia.document_revision (
  document_id text NOT NULL REFERENCES hestia.document_head(document_id),
  revision bigint NOT NULL CHECK (revision > 0),
  revision_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  previous_revision_root bytea REFERENCES gw_ledger."Cell"(hash),
  previous_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  batch_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  transformation_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  transformed_operations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  author_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  author_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  environment_id text NOT NULL,
  environment_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  signed_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  result_ast_projection jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (document_id, revision),
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root)
);

CREATE TABLE hestia.document_operation_projection (
  document_id text NOT NULL,
  revision bigint NOT NULL,
  operation_index integer NOT NULL CHECK (operation_index >= 0),
  operation_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  operation_projection jsonb NOT NULL,
  PRIMARY KEY (document_id, revision, operation_index),
  FOREIGN KEY (document_id, revision)
    REFERENCES hestia.document_revision(document_id, revision)
);

CREATE TABLE hestia.document_batch_admission (
  batch_record_root bytea PRIMARY KEY REFERENCES gw_ledger."Cell"(hash),
  transformation_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  document_id text NOT NULL CHECK (length(document_id) BETWEEN 1 AND 512),
  batch_id text NOT NULL CHECK (length(batch_id) BETWEEN 1 AND 512),
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  base_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  original_operations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_result_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  author_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  expected_author_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_author_profile_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  author_operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  author_delegation_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_current_revision bigint NOT NULL CHECK (expected_current_revision >= 0),
  expected_current_revision_root bytea REFERENCES gw_ledger."Cell"(hash),
  expected_current_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  transformed_operations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_ast_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_revision bigint,
  revision_root bytea UNIQUE REFERENCES gw_ledger."Cell"(hash),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'conflict')),
  conflict_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  transformed_operations_projection jsonb NOT NULL,
  result_ast_projection jsonb NOT NULL,
  conflict_projection jsonb,
  import_sequence bigint NOT NULL UNIQUE CHECK (import_sequence > 0),
  import_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  environment_id text NOT NULL,
  environment_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  environment_signature_root bytea REFERENCES gw_ledger."Cell"(hash),
  signed_receipt_root bytea UNIQUE REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('pending-signature', 'accepted', 'conflict')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root),
  CHECK ((outcome = 'accepted'
          AND result_revision IS NOT NULL
          AND revision_root IS NOT NULL)
      OR (outcome = 'conflict'
          AND result_revision IS NULL
          AND revision_root IS NULL)),
  CHECK ((status = 'pending-signature'
          AND environment_signature_root IS NULL
          AND signed_receipt_root IS NULL
          AND completed_at IS NULL)
      OR (status IN ('accepted', 'conflict')
          AND environment_signature_root IS NOT NULL
          AND signed_receipt_root IS NOT NULL
          AND completed_at IS NOT NULL))
);

CREATE FUNCTION hestia.document_record_roles(p_kind text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'document/text-splice' THEN
      ARRAY['operation-id','document-id','target','offset','delete-count','insert',
            'base-revision']::text[]
    WHEN 'document/node-insert' THEN
      ARRAY['operation-id','document-id','parent','before','after','node',
            'base-revision']::text[]
    WHEN 'document/node-delete' THEN
      ARRAY['operation-id','document-id','target','expected','base-revision']::text[]
    WHEN 'document/node-set-attrs' THEN
      ARRAY['operation-id','document-id','target','expected-attrs','attrs',
            'base-revision']::text[]
    WHEN 'document/artefact-commit' THEN
      ARRAY['operation-id','document-id','artefact-id','artefact-node','source-text',
            'source','result','media-type','display','base-revision']::text[]
    WHEN 'document/batch' THEN
      ARRAY['batch-id','document-id','base-revision','base-ast','operations',
            'expected-result','author-profile','delegation']::text[]
    WHEN 'document/transformation' THEN
      ARRAY['transformation-id','document-id','batch','base-revision',
            'previous-revision','previous-ast','transformed-operations','result-ast',
            'outcome','conflict']::text[]
    WHEN 'document/revision' THEN
      ARRAY['document-id','revision','previous-revision','previous-ast','batch',
            'transformation','transformed-operations','result-ast','author-profile',
            'environment-key']::text[]
    WHEN 'document/import-receipt' THEN
      ARRAY['document-id','batch','transformation','base-revision',
            'previous-revision','transformed-operations','result-revision',
            'result-ast','outcome','sequence']::text[]
    WHEN 'document/verification-receipt' THEN
      ARRAY['record','body','signer-key','environment-key','outcome','sequence']::text[]
    WHEN 'document/signed-record' THEN
      ARRAY['body','signer-key','signature']::text[]
    ELSE NULL
  END
$$;

CREATE FUNCTION hestia.document_record_submittable(p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_kind = ANY (ARRAY[
    'document/batch',
    'document/transformation'
  ]::text[])
$$;

CREATE FUNCTION hestia.document_record_put(p_kind text, p_roots bytea[])
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
  v_roles := hestia.document_record_roles(p_kind);
  IF v_roles IS NULL THEN
    RAISE EXCEPTION 'unknown Hestia document record kind: %', p_kind;
  END IF;
  IF cardinality(v_roles) <> cardinality(p_roots) THEN
    RAISE EXCEPTION 'Hestia document record field count mismatch for %', p_kind;
  END IF;
  v_payload_text := 'R:greenways-document/1:' || p_kind || ':1:'
                    || cardinality(p_roots)::text || ':';
  FOR v_index IN 1..cardinality(p_roots) LOOP
    IF p_roots[v_index] IS NULL OR octet_length(p_roots[v_index]) <> 32
       OR NOT EXISTS (
         SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_roots[v_index]
       ) THEN
      RAISE EXCEPTION 'invalid or missing document HCV1 child at position % for %',
                      v_index - 1, p_kind;
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

CREATE FUNCTION hestia.document_record_validate_body(
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
BEGIN
  v_roles := hestia.document_record_roles(p_kind);
  IF v_roles IS NULL OR NOT hestia.document_record_submittable(p_kind) THEN
    RAISE EXCEPTION 'unsupported submitted document record kind: %', p_kind;
  END IF;
  IF gw_ledger.cell_type_tag(p_body_root) <> 14
     OR jsonb_array_length(gw_ledger.cell_ref_entries(p_body_root))
        <> cardinality(v_roles) THEN
    RAISE EXCEPTION 'document record body shape mismatch for %', p_kind;
  END IF;
  SELECT payload INTO STRICT v_payload
    FROM gw_ledger."Cell"
   WHERE hash = p_body_root;
  v_expected := 'R:greenways-document/1:' || p_kind || ':1:'
                || cardinality(v_roles)::text || ':';
  FOR v_index IN 1..cardinality(v_roles) LOOP
    v_child := gw_ledger.cell_ref_child(
      p_body_root,
      v_index - 1,
      v_roles[v_index]
    );
    v_expected := v_expected || encode(v_child, 'hex');
  END LOOP;
  IF v_payload <> convert_to(v_expected, 'UTF8') THEN
    RAISE EXCEPTION 'document record body payload/reference mismatch for %', p_kind;
  END IF;
END;
$$;

CREATE FUNCTION hestia.document_signing_payload(
  p_kind text,
  p_body_root bytea
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT convert_to('GWDP1', 'UTF8')
         || decode('00', 'hex')
         || convert_to(p_kind, 'UTF8')
         || decode('00', 'hex')
         || p_body_root
$$;

CREATE FUNCTION hestia.document_signed_record_check(
  p_signed_record_root bytea,
  p_kind text
)
RETURNS TABLE (
  body_root bytea,
  signer_key_root bytea,
  signature_root bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload bytea;
  v_expected text;
  v_public_key bytea;
  v_signature bytea;
BEGIN
  IF gw_ledger.cell_type_tag(p_signed_record_root) <> 14
     OR jsonb_array_length(gw_ledger.cell_ref_entries(p_signed_record_root)) <> 3 THEN
    RAISE EXCEPTION 'submitted root is not a document signed record';
  END IF;
  body_root := gw_ledger.cell_ref_child(p_signed_record_root, 0, 'body');
  signer_key_root := gw_ledger.cell_ref_child(p_signed_record_root, 1, 'signer-key');
  signature_root := gw_ledger.cell_ref_child(p_signed_record_root, 2, 'signature');
  v_expected := 'R:greenways-document/1:document/signed-record:1:3:'
                || encode(body_root, 'hex')
                || encode(signer_key_root, 'hex')
                || encode(signature_root, 'hex');
  SELECT payload INTO STRICT v_payload
    FROM gw_ledger."Cell"
   WHERE hash = p_signed_record_root;
  IF v_payload <> convert_to(v_expected, 'UTF8') THEN
    RAISE EXCEPTION 'document signed record payload/reference mismatch';
  END IF;
  PERFORM hestia.document_record_validate_body(p_kind, body_root);
  IF gw_ledger.cell_type_tag(signer_key_root) <> 6
     OR gw_ledger.cell_type_tag(signature_root) <> 6 THEN
    RAISE EXCEPTION 'document signer key and signature must be HCV1 blobs';
  END IF;
  SELECT payload INTO STRICT v_public_key
    FROM gw_ledger."Cell" WHERE hash = signer_key_root;
  SELECT payload INTO STRICT v_signature
    FROM gw_ledger."Cell" WHERE hash = signature_root;
  IF octet_length(v_public_key) <> 32 OR octet_length(v_signature) <> 64
     OR NOT gw_ledger.signature_verify(
       v_signature,
       hestia.document_signing_payload(p_kind, body_root),
       v_public_key
     ) THEN
    RAISE EXCEPTION 'invalid GWDP1 document signature';
  END IF;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.environment_document_signed_record_put(
  p_environment_id text,
  p_environment_key_root bytea,
  p_body_root bytea,
  p_kind text,
  p_signature bytea
)
RETURNS TABLE (
  signature_root bytea,
  signed_record_root bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_environment hestia.environment_signer%ROWTYPE;
BEGIN
  SELECT * INTO v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = p_environment_key_root
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document environment signer is not active';
  END IF;
  IF p_signature IS NULL OR octet_length(p_signature) <> 64
     OR NOT gw_ledger.signature_verify(
       p_signature,
       hestia.document_signing_payload(p_kind, p_body_root),
       v_environment.public_key
     ) THEN
    RAISE EXCEPTION 'invalid Hestia document environment signature';
  END IF;
  signature_root := hestia.hcv1_blob_put(p_signature);
  signed_record_root := hestia.document_record_put(
    'document/signed-record',
    ARRAY[p_body_root, p_environment_key_root, signature_root]::bytea[]
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.document_record_verify_prepare(
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
  v_existing hestia.document_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_body_root bytea;
  v_signer_key_root bytea;
  v_signature_root bytea;
  v_outcome_root bytea;
  v_sequence_root bytea;
  v_receipt_root bytea;
  v_sequence bigint;
BEGIN
  IF p_pack IS NULL OR octet_length(p_pack) > 1000000
     OR p_cell_count IS NULL OR p_cell_count < 1 OR p_cell_count > 128 THEN
    RAISE EXCEPTION 'HCP1 document pack is outside the admission bound';
  END IF;
  IF NOT hestia.document_record_submittable(p_record_kind) THEN
    RAISE EXCEPTION 'unsupported submitted document record kind: %', p_record_kind;
  END IF;
  SELECT * INTO v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hestia environment has no active signing key';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(encode(p_signed_record_root, 'hex'), 11)
  );
  SELECT * INTO v_existing
    FROM hestia.document_record_verification
   WHERE signed_record_root = p_signed_record_root;
  IF FOUND THEN
    IF v_existing.record_kind <> p_record_kind
       OR v_existing.environment_id <> p_environment_id THEN
      RAISE EXCEPTION 'document record verification identity conflict';
    END IF;
    sequence := v_existing.sequence;
    body_root := v_existing.body_root;
    signer_key_root := v_existing.signer_key_root;
    verification_receipt_root := v_existing.verification_receipt_root;
    receipt_signing_payload := hestia.document_signing_payload(
      'document/verification-receipt',
      v_existing.verification_receipt_root
    );
    RETURN NEXT;
    RETURN;
  END IF;
  IF NOT gw_ledger.snapshot_pack_import(p_pack, p_cell_count) THEN
    RAISE EXCEPTION 'HCP1 document pack import failed';
  END IF;
  SELECT *
    INTO v_body_root, v_signer_key_root, v_signature_root
    FROM hestia.document_signed_record_check(p_signed_record_root, p_record_kind);
  v_sequence := nextval('hestia.document_record_verification_sequence'::regclass);
  v_outcome_root := hestia.hcv1_string_put('signature-verified');
  v_sequence_root := hestia.hcv1_integer_put(v_sequence);
  v_receipt_root := hestia.document_record_put(
    'document/verification-receipt',
    ARRAY[
      p_signed_record_root,
      v_body_root,
      v_signer_key_root,
      v_environment.key_root,
      v_outcome_root,
      v_sequence_root
    ]::bytea[]
  );
  INSERT INTO hestia.document_record_verification (
    sequence, signed_record_root, record_kind, body_root, signer_key_root,
    signature_root, environment_id, environment_key_root,
    verification_receipt_root, status
  ) VALUES (
    v_sequence, p_signed_record_root, p_record_kind, v_body_root,
    v_signer_key_root, v_signature_root, p_environment_id,
    v_environment.key_root, v_receipt_root, 'pending-signature'
  );
  sequence := v_sequence;
  body_root := v_body_root;
  signer_key_root := v_signer_key_root;
  verification_receipt_root := v_receipt_root;
  receipt_signing_payload := hestia.document_signing_payload(
    'document/verification-receipt', v_receipt_root
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.document_record_verify_commit(
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
  v_row hestia.document_record_verification%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
BEGIN
  SELECT * INTO v_row
    FROM hestia.document_record_verification
   WHERE signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND OR v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'document record has not been prepared in this environment';
  END IF;
  IF v_row.status = 'verified' THEN
    RETURN v_row.signed_receipt_root;
  END IF;
  SELECT signature_root, signed_record_root
    INTO v_signature_root, v_signed_receipt_root
    FROM hestia.environment_document_signed_record_put(
      p_environment_id,
      v_row.environment_key_root,
      v_row.verification_receipt_root,
      'document/verification-receipt',
      p_environment_signature
    );
  UPDATE hestia.document_record_verification
     SET environment_signature_root = v_signature_root,
         signed_receipt_root = v_signed_receipt_root,
         status = 'verified',
         verified_at = clock_timestamp()
   WHERE signed_record_root = p_signed_record_root;
  RETURN v_signed_receipt_root;
END;
$$;

CREATE FUNCTION hestia.document_batch_prepare(
  p_environment_id text,
  p_batch_record_root bytea,
  p_transformation_record_root bytea,
  p_expected_current_revision bigint,
  p_expected_current_revision_root bytea,
  p_expected_current_ast_root bytea,
  p_transformed_operations_projection jsonb,
  p_result_ast_projection jsonb,
  p_conflict_projection jsonb
)
RETURNS TABLE (
  document_id text,
  outcome text,
  import_sequence bigint,
  result_revision bigint,
  revision_root bytea,
  result_ast_root bytea,
  import_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.document_batch_admission%ROWTYPE;
  v_batch_verification hestia.document_record_verification%ROWTYPE;
  v_transform_verification hestia.document_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_author hestia.agent_profile%ROWTYPE;
  v_head hestia.document_head%ROWTYPE;
  v_base_revision_row hestia.document_revision%ROWTYPE;
  v_batch_body bytea;
  v_transform_body bytea;
  v_batch_id text;
  v_document_id text;
  v_transform_document_id text;
  v_base_revision bigint;
  v_transform_base_revision bigint;
  v_base_ast_root bytea;
  v_original_operations_root bytea;
  v_expected_result_root bytea;
  v_author_profile_root bytea;
  v_delegation_root bytea;
  v_transform_batch_root bytea;
  v_previous_revision_field bytea;
  v_previous_revision_root bytea;
  v_previous_ast_root bytea;
  v_transformed_operations_root bytea;
  v_result_ast_root bytea;
  v_outcome text;
  v_conflict_root bytea;
  v_current_revision bigint;
  v_current_revision_root bytea;
  v_current_ast_root bytea;
  v_origin_ast_root bytea;
  v_result_revision bigint;
  v_revision_root bytea;
  v_revision_number_root bytea;
  v_previous_revision_ref bytea;
  v_document_id_root bytea;
  v_outcome_root bytea;
  v_sequence_root bytea;
  v_result_revision_ref bytea;
  v_import_sequence bigint;
  v_receipt_root bytea;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.document_batch_admission
   WHERE batch_record_root = p_batch_record_root;
  IF FOUND THEN
    IF v_existing.transformation_record_root <> p_transformation_record_root
       OR v_existing.environment_id <> p_environment_id THEN
      RAISE EXCEPTION 'document batch admission identity conflict';
    END IF;
    document_id := v_existing.document_id;
    outcome := v_existing.outcome;
    import_sequence := v_existing.import_sequence;
    result_revision := v_existing.result_revision;
    revision_root := v_existing.revision_root;
    result_ast_root := v_existing.result_ast_root;
    import_receipt_root := v_existing.import_receipt_root;
    receipt_signing_payload := hestia.document_signing_payload(
      'document/import-receipt', v_existing.import_receipt_root
    );
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_batch_verification
    FROM hestia.document_record_verification
   WHERE signed_record_root = p_batch_record_root
     AND record_kind = 'document/batch'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document batch requires a verified GWDP1 receipt';
  END IF;
  SELECT * INTO v_transform_verification
    FROM hestia.document_record_verification
   WHERE signed_record_root = p_transformation_record_root
     AND record_kind = 'document/transformation'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document transformation requires a verified GWDP1 receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND status = 'active';
  IF v_transform_verification.signer_key_root <> v_environment.key_root THEN
    RAISE EXCEPTION 'document transformation is not signed by the active environment';
  END IF;

  v_batch_body := v_batch_verification.body_root;
  v_transform_body := v_transform_verification.body_root;
  v_batch_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_batch_body, 0, 'batch-id')
  );
  v_document_id_root := gw_ledger.cell_ref_child(v_batch_body, 1, 'document-id');
  v_document_id := hestia.hcv1_text(v_document_id_root);
  v_base_revision := hestia.hcv1_bigint(
    gw_ledger.cell_ref_child(v_batch_body, 2, 'base-revision')
  );
  v_base_ast_root := gw_ledger.cell_ref_child(v_batch_body, 3, 'base-ast');
  v_original_operations_root := gw_ledger.cell_ref_child(v_batch_body, 4, 'operations');
  v_expected_result_root := gw_ledger.cell_ref_child(v_batch_body, 5, 'expected-result');
  v_author_profile_root := gw_ledger.cell_ref_child(v_batch_body, 6, 'author-profile');
  v_delegation_root := gw_ledger.cell_ref_child(v_batch_body, 7, 'delegation');

  v_transform_document_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_transform_body, 1, 'document-id')
  );
  v_transform_batch_root := gw_ledger.cell_ref_child(v_transform_body, 2, 'batch');
  v_transform_base_revision := hestia.hcv1_bigint(
    gw_ledger.cell_ref_child(v_transform_body, 3, 'base-revision')
  );
  v_previous_revision_field := gw_ledger.cell_ref_child(
    v_transform_body, 4, 'previous-revision'
  );
  v_previous_ast_root := gw_ledger.cell_ref_child(v_transform_body, 5, 'previous-ast');
  v_transformed_operations_root := gw_ledger.cell_ref_child(
    v_transform_body, 6, 'transformed-operations'
  );
  v_result_ast_root := gw_ledger.cell_ref_child(v_transform_body, 7, 'result-ast');
  v_outcome := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_transform_body, 8, 'outcome')
  );
  v_conflict_root := gw_ledger.cell_ref_child(v_transform_body, 9, 'conflict');

  IF v_document_id <> v_transform_document_id
     OR v_transform_batch_root <> p_batch_record_root
     OR v_base_revision <> v_transform_base_revision
     OR v_base_revision < 0
     OR v_outcome NOT IN ('accepted', 'conflict') THEN
    RAISE EXCEPTION 'document transformation does not bind its exact batch';
  END IF;
  IF gw_ledger.cell_type_tag(v_original_operations_root) <> 10
     OR gw_ledger.cell_type_tag(v_transformed_operations_root) <> 10
     OR jsonb_typeof(p_transformed_operations_projection) <> 'array'
     OR jsonb_array_length(gw_ledger.cell_ref_entries(v_transformed_operations_root))
        <> jsonb_array_length(p_transformed_operations_projection) THEN
    RAISE EXCEPTION 'document transformed operation projection does not match its HCV1 vector';
  END IF;
  IF p_result_ast_projection IS NULL THEN
    RAISE EXCEPTION 'document result AST projection is required';
  END IF;

  SELECT * INTO v_author
    FROM hestia.agent_profile
   WHERE current_record_root = v_author_profile_root
     AND status = 'active'
   FOR UPDATE;
  IF NOT FOUND
     OR v_author.operational_key_root <> v_batch_verification.signer_key_root
     OR v_author.delegation_root <> v_delegation_root
     OR NOT hestia.agent_profile_authorized(
       v_author.profile_id,
       v_author.current_record_root,
       v_batch_verification.signer_key_root,
       'document.edit'
     ) THEN
    RAISE EXCEPTION 'document batch lacks current delegated edit authority';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_document_id, 19));
  SELECT * INTO v_head
    FROM hestia.document_head
   WHERE document_id = v_document_id
   FOR UPDATE;
  IF FOUND THEN
    v_current_revision := v_head.current_revision;
    v_current_revision_root := v_head.current_revision_root;
    v_current_ast_root := v_head.current_ast_root;
    v_origin_ast_root := v_head.origin_ast_root;
  ELSE
    v_current_revision := 0;
    v_current_revision_root := NULL;
    v_current_ast_root := v_base_ast_root;
    v_origin_ast_root := v_base_ast_root;
  END IF;

  IF p_expected_current_revision <> v_current_revision
     OR p_expected_current_revision_root IS DISTINCT FROM v_current_revision_root
     OR p_expected_current_ast_root <> v_current_ast_root THEN
    RAISE EXCEPTION 'document head changed before ledger preparation';
  END IF;
  IF v_current_revision = 0 THEN
    IF NOT hestia.hcv1_is_nil(v_previous_revision_field)
       OR v_previous_ast_root <> v_current_ast_root THEN
      RAISE EXCEPTION 'first document transformation does not bind the origin head';
    END IF;
    v_previous_revision_root := NULL;
  ELSE
    IF v_previous_revision_field <> v_current_revision_root
       OR v_previous_ast_root <> v_current_ast_root THEN
      RAISE EXCEPTION 'document transformation does not bind the current head';
    END IF;
    v_previous_revision_root := v_current_revision_root;
  END IF;
  IF v_base_revision = 0 THEN
    IF v_base_ast_root <> v_origin_ast_root THEN
      RAISE EXCEPTION 'document batch origin AST does not match the ledger';
    END IF;
  ELSE
    SELECT * INTO v_base_revision_row
      FROM hestia.document_revision
     WHERE document_id = v_document_id
       AND revision = v_base_revision;
    IF NOT FOUND OR v_base_revision_row.result_ast_root <> v_base_ast_root THEN
      RAISE EXCEPTION 'document batch base revision is not in the ledger history';
    END IF;
  END IF;
  IF v_base_revision > v_current_revision THEN
    RAISE EXCEPTION 'document batch base revision is ahead of the current head';
  END IF;

  v_import_sequence := nextval('hestia.document_import_sequence'::regclass);
  v_previous_revision_ref := COALESCE(
    v_current_revision_root,
    hestia.hcv1_nil_put()
  );
  v_outcome_root := hestia.hcv1_string_put(v_outcome);
  v_sequence_root := hestia.hcv1_integer_put(v_import_sequence);
  IF v_outcome = 'accepted' THEN
    v_result_revision := v_current_revision + 1;
    v_revision_number_root := hestia.hcv1_integer_put(v_result_revision);
    v_revision_root := hestia.document_record_put(
      'document/revision',
      ARRAY[
        v_document_id_root,
        v_revision_number_root,
        v_previous_revision_ref,
        v_current_ast_root,
        p_batch_record_root,
        p_transformation_record_root,
        v_transformed_operations_root,
        v_result_ast_root,
        v_author.current_record_root,
        v_environment.key_root
      ]::bytea[]
    );
    v_result_revision_ref := v_revision_root;
  ELSE
    IF v_result_ast_root <> v_current_ast_root THEN
      RAISE EXCEPTION 'conflicted transformation must preserve the current AST root';
    END IF;
    v_result_revision := NULL;
    v_revision_root := NULL;
    v_result_revision_ref := hestia.hcv1_nil_put();
  END IF;
  v_receipt_root := hestia.document_record_put(
    'document/import-receipt',
    ARRAY[
      v_document_id_root,
      p_batch_record_root,
      p_transformation_record_root,
      gw_ledger.cell_ref_child(v_batch_body, 2, 'base-revision'),
      v_previous_revision_ref,
      v_transformed_operations_root,
      v_result_revision_ref,
      v_result_ast_root,
      v_outcome_root,
      v_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.document_batch_admission (
    batch_record_root, transformation_record_root, document_id, batch_id,
    base_revision, base_ast_root, original_operations_root, expected_result_root,
    author_profile_id, expected_author_profile_record_root,
    expected_author_profile_state_root, author_operational_key_root,
    author_delegation_root, expected_current_revision,
    expected_current_revision_root, expected_current_ast_root,
    transformed_operations_root, result_ast_root, result_revision, revision_root,
    outcome, conflict_root, transformed_operations_projection,
    result_ast_projection, conflict_projection, import_sequence,
    import_receipt_root, environment_id, environment_key_root, status
  ) VALUES (
    p_batch_record_root, p_transformation_record_root, v_document_id, v_batch_id,
    v_base_revision, v_base_ast_root, v_original_operations_root,
    v_expected_result_root, v_author.profile_id, v_author.current_record_root,
    v_author.current_state_root, v_author.operational_key_root,
    v_author.delegation_root, v_current_revision, v_current_revision_root,
    v_current_ast_root, v_transformed_operations_root, v_result_ast_root,
    v_result_revision, v_revision_root, v_outcome, v_conflict_root,
    p_transformed_operations_projection, p_result_ast_projection,
    p_conflict_projection, v_import_sequence, v_receipt_root,
    p_environment_id, v_environment.key_root, 'pending-signature'
  );

  document_id := v_document_id;
  outcome := v_outcome;
  import_sequence := v_import_sequence;
  result_revision := v_result_revision;
  revision_root := v_revision_root;
  result_ast_root := v_result_ast_root;
  import_receipt_root := v_receipt_root;
  receipt_signing_payload := hestia.document_signing_payload(
    'document/import-receipt', v_receipt_root
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.document_batch_commit(
  p_environment_id text,
  p_batch_record_root bytea,
  p_transformation_record_root bytea,
  p_environment_signature bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row hestia.document_batch_admission%ROWTYPE;
  v_head hestia.document_head%ROWTYPE;
  v_author hestia.agent_profile%ROWTYPE;
  v_batch_verification hestia.document_record_verification%ROWTYPE;
  v_transform_verification hestia.document_record_verification%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_operation_root bytea;
  v_index integer;
BEGIN
  SELECT * INTO v_row
    FROM hestia.document_batch_admission
   WHERE batch_record_root = p_batch_record_root
   FOR UPDATE;
  IF NOT FOUND
     OR v_row.transformation_record_root <> p_transformation_record_root
     OR v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'document batch has not been prepared in this environment';
  END IF;
  IF v_row.status IN ('accepted', 'conflict') THEN
    RETURN v_row.signed_receipt_root;
  END IF;

  SELECT * INTO v_head
    FROM hestia.document_head
   WHERE document_id = v_row.document_id
   FOR UPDATE;
  IF v_row.expected_current_revision = 0 THEN
    IF FOUND THEN
      RAISE EXCEPTION 'document head appeared after preparation';
    END IF;
  ELSE
    IF NOT FOUND
       OR v_head.current_revision <> v_row.expected_current_revision
       OR v_head.current_revision_root <> v_row.expected_current_revision_root
       OR v_head.current_ast_root <> v_row.expected_current_ast_root THEN
      RAISE EXCEPTION 'document head changed after transformation preparation';
    END IF;
  END IF;

  SELECT * INTO v_author
    FROM hestia.agent_profile
   WHERE profile_id = v_row.author_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_author.current_record_root <> v_row.expected_author_profile_record_root
     OR v_author.current_state_root <> v_row.expected_author_profile_state_root
     OR v_author.operational_key_root <> v_row.author_operational_key_root
     OR v_author.delegation_root <> v_row.author_delegation_root
     OR v_author.status <> 'active'
     OR NOT hestia.agent_profile_authorized(
       v_author.profile_id,
       v_author.current_record_root,
       v_author.operational_key_root,
       'document.edit'
     ) THEN
    RAISE EXCEPTION 'document author authority changed after preparation';
  END IF;
  SELECT * INTO v_batch_verification
    FROM hestia.document_record_verification
   WHERE signed_record_root = v_row.batch_record_root
     AND record_kind = 'document/batch'
     AND status = 'verified';
  SELECT * INTO v_transform_verification
    FROM hestia.document_record_verification
   WHERE signed_record_root = v_row.transformation_record_root
     AND record_kind = 'document/transformation'
     AND status = 'verified';
  IF NOT FOUND
     OR v_batch_verification.signer_key_root <> v_row.author_operational_key_root
     OR v_transform_verification.signer_key_root <> v_row.environment_key_root THEN
    RAISE EXCEPTION 'document signatures changed after preparation';
  END IF;

  SELECT signature_root, signed_record_root
    INTO v_signature_root, v_signed_receipt_root
    FROM hestia.environment_document_signed_record_put(
      p_environment_id,
      v_row.environment_key_root,
      v_row.import_receipt_root,
      'document/import-receipt',
      p_environment_signature
    );

  IF v_row.outcome = 'accepted' THEN
    IF v_row.expected_current_revision = 0 THEN
      INSERT INTO hestia.document_head (
        document_id, current_revision, current_revision_root, current_ast_root,
        origin_ast_root, environment_id, environment_key_root
      ) VALUES (
        v_row.document_id, 0, NULL, v_row.expected_current_ast_root,
        v_row.expected_current_ast_root, p_environment_id,
        v_row.environment_key_root
      );
    END IF;
    INSERT INTO hestia.document_revision (
      document_id, revision, revision_root, previous_revision_root,
      previous_ast_root, batch_record_root, transformation_record_root,
      transformed_operations_root, result_ast_root, author_profile_id,
      author_profile_record_root, environment_id, environment_key_root,
      signed_receipt_root, result_ast_projection
    ) VALUES (
      v_row.document_id, v_row.result_revision, v_row.revision_root,
      v_row.expected_current_revision_root, v_row.expected_current_ast_root,
      v_row.batch_record_root, v_row.transformation_record_root,
      v_row.transformed_operations_root, v_row.result_ast_root,
      v_row.author_profile_id, v_row.expected_author_profile_record_root,
      p_environment_id, v_row.environment_key_root, v_signed_receipt_root,
      v_row.result_ast_projection
    );
    IF jsonb_array_length(v_row.transformed_operations_projection) > 0 THEN
      FOR v_index IN 0..jsonb_array_length(v_row.transformed_operations_projection) - 1 LOOP
        v_operation_root := gw_ledger.cell_ref_child(
          v_row.transformed_operations_root, v_index, 'element'
        );
        INSERT INTO hestia.document_operation_projection (
          document_id, revision, operation_index, operation_root,
          operation_projection
        ) VALUES (
          v_row.document_id, v_row.result_revision, v_index, v_operation_root,
          v_row.transformed_operations_projection -> v_index
        );
      END LOOP;
    END IF;
    UPDATE hestia.document_head
       SET current_revision = v_row.result_revision,
           current_revision_root = v_row.revision_root,
           current_ast_root = v_row.result_ast_root,
           environment_id = p_environment_id,
           environment_key_root = v_row.environment_key_root,
           updated_at = clock_timestamp()
     WHERE document_id = v_row.document_id;
  END IF;

  UPDATE hestia.document_batch_admission
     SET environment_signature_root = v_signature_root,
         signed_receipt_root = v_signed_receipt_root,
         status = v_row.outcome,
         completed_at = clock_timestamp()
   WHERE batch_record_root = p_batch_record_root;
  RETURN v_signed_receipt_root;
END;
$$;

CREATE TRIGGER document_revision_no_update
BEFORE UPDATE OR DELETE ON hestia.document_revision
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER document_operation_projection_no_update
BEFORE UPDATE OR DELETE ON hestia.document_operation_projection
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

REVOKE ALL ON hestia.document_record_verification FROM PUBLIC;
REVOKE ALL ON hestia.document_head FROM PUBLIC;
REVOKE ALL ON hestia.document_revision FROM PUBLIC;
REVOKE ALL ON hestia.document_operation_projection FROM PUBLIC;
REVOKE ALL ON hestia.document_batch_admission FROM PUBLIC;
REVOKE ALL ON SEQUENCE hestia.document_record_verification_sequence FROM PUBLIC;
REVOKE ALL ON SEQUENCE hestia.document_import_sequence FROM PUBLIC;

REVOKE ALL ON FUNCTION hestia.document_record_roles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_record_submittable(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_record_put(text, bytea[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_record_validate_body(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_signing_payload(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_signed_record_check(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.environment_document_signed_record_put(text, bytea, bytea, text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_record_verify_prepare(text, bytea, bigint, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_record_verify_commit(text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_batch_prepare(text, bytea, bytea, bigint, bytea, bytea, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.document_batch_commit(text, bytea, bytea, bytea) FROM PUBLIC;

GRANT SELECT ON hestia.document_record_verification TO hestia_app;
GRANT SELECT ON hestia.document_head TO hestia_app;
GRANT SELECT ON hestia.document_revision TO hestia_app;
GRANT SELECT ON hestia.document_operation_projection TO hestia_app;
GRANT SELECT ON hestia.document_batch_admission TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.document_record_verify_prepare(text, bytea, bigint, bytea, text) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.document_record_verify_commit(text, bytea, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.document_batch_prepare(text, bytea, bytea, bigint, bytea, bytea, jsonb, jsonb, jsonb) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.document_batch_commit(text, bytea, bytea, bytea) TO hestia_app;

COMMENT ON TABLE hestia.document_head IS
  'Mutable pointer to the latest accepted document revision; canonical AST and revision roots remain in gw_ledger.';
COMMENT ON TABLE hestia.document_revision IS
  'Append-only projection of environment-signed document revisions created from contributor batches after OT.';
COMMENT ON TABLE hestia.document_operation_projection IS
  'Non-canonical JSON projection for future transformation; operation_root is the authoritative HCV1 identity.';
COMMENT ON TABLE hestia.document_batch_admission IS
  'Two-stage document OT admission. The database constructs the canonical revision and receipt and signs only after rechecking the exact head.';
COMMENT ON FUNCTION hestia.document_batch_prepare(text, bytea, bytea, bigint, bytea, bytea, jsonb, jsonb, jsonb) IS
  'Binds a verified contributor batch and environment transformation to the current Hara ledger head, then returns exact GWDP1 receipt signing bytes.';
COMMENT ON FUNCTION hestia.document_batch_commit(text, bytea, bytea, bytea) IS
  'Rechecks head and delegated authority, verifies the environment GWDP1 signature, and atomically appends the revision, transformed operations and signed receipt.';
