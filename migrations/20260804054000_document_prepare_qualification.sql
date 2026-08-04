CREATE OR REPLACE FUNCTION hestia.document_batch_prepare(
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
  SELECT admission.* INTO v_existing
    FROM hestia.document_batch_admission AS admission
   WHERE admission.batch_record_root = p_batch_record_root;
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
      'document/import-receipt',
      v_existing.import_receipt_root
    );
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT verification.* INTO v_batch_verification
    FROM hestia.document_record_verification AS verification
   WHERE verification.signed_record_root = p_batch_record_root
     AND verification.record_kind = 'document/batch'
     AND verification.environment_id = p_environment_id
     AND verification.status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document batch requires a verified GWDP1 receipt';
  END IF;

  SELECT verification.* INTO v_transform_verification
    FROM hestia.document_record_verification AS verification
   WHERE verification.signed_record_root = p_transformation_record_root
     AND verification.record_kind = 'document/transformation'
     AND verification.environment_id = p_environment_id
     AND verification.status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document transformation requires a verified GWDP1 receipt';
  END IF;

  SELECT environment.* INTO STRICT v_environment
    FROM hestia.environment_signer AS environment
   WHERE environment.environment_id = p_environment_id
     AND environment.status = 'active';
  IF v_transform_verification.signer_key_root <> v_environment.key_root THEN
    RAISE EXCEPTION 'document transformation is not signed by the active environment';
  END IF;

  v_batch_body := v_batch_verification.body_root;
  v_transform_body := v_transform_verification.body_root;
  v_batch_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_batch_body, 0, 'batch-id')
  );
  v_document_id_root := gw_ledger.cell_ref_child(
    v_batch_body, 1, 'document-id'
  );
  v_document_id := hestia.hcv1_text(v_document_id_root);
  v_base_revision := hestia.hcv1_bigint(
    gw_ledger.cell_ref_child(v_batch_body, 2, 'base-revision')
  );
  v_base_ast_root := gw_ledger.cell_ref_child(v_batch_body, 3, 'base-ast');
  v_original_operations_root := gw_ledger.cell_ref_child(
    v_batch_body, 4, 'operations'
  );
  v_expected_result_root := gw_ledger.cell_ref_child(
    v_batch_body, 5, 'expected-result'
  );
  v_author_profile_root := gw_ledger.cell_ref_child(
    v_batch_body, 6, 'author-profile'
  );
  v_delegation_root := gw_ledger.cell_ref_child(
    v_batch_body, 7, 'delegation'
  );

  v_transform_document_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_transform_body, 1, 'document-id')
  );
  v_transform_batch_root := gw_ledger.cell_ref_child(
    v_transform_body, 2, 'batch'
  );
  v_transform_base_revision := hestia.hcv1_bigint(
    gw_ledger.cell_ref_child(v_transform_body, 3, 'base-revision')
  );
  v_previous_revision_field := gw_ledger.cell_ref_child(
    v_transform_body, 4, 'previous-revision'
  );
  v_previous_ast_root := gw_ledger.cell_ref_child(
    v_transform_body, 5, 'previous-ast'
  );
  v_transformed_operations_root := gw_ledger.cell_ref_child(
    v_transform_body, 6, 'transformed-operations'
  );
  v_result_ast_root := gw_ledger.cell_ref_child(
    v_transform_body, 7, 'result-ast'
  );
  v_outcome := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_transform_body, 8, 'outcome')
  );
  v_conflict_root := gw_ledger.cell_ref_child(
    v_transform_body, 9, 'conflict'
  );

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
     OR jsonb_array_length(
       gw_ledger.cell_ref_entries(v_transformed_operations_root)
     ) <> jsonb_array_length(p_transformed_operations_projection) THEN
    RAISE EXCEPTION 'document transformed operation projection does not match its HCV1 vector';
  END IF;
  IF p_result_ast_projection IS NULL THEN
    RAISE EXCEPTION 'document result AST projection is required';
  END IF;

  SELECT author.* INTO v_author
    FROM hestia.agent_profile AS author
   WHERE author.current_record_root = v_author_profile_root
     AND author.status = 'active'
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
  SELECT head.* INTO v_head
    FROM hestia.document_head AS head
   WHERE head.document_id = v_document_id
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
    SELECT base_revision_row.* INTO v_base_revision_row
      FROM hestia.document_revision AS base_revision_row
     WHERE base_revision_row.document_id = v_document_id
       AND base_revision_row.revision = v_base_revision;
    IF NOT FOUND
       OR v_base_revision_row.result_ast_root <> v_base_ast_root THEN
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
    batch_record_root,
    transformation_record_root,
    document_id,
    batch_id,
    base_revision,
    base_ast_root,
    original_operations_root,
    expected_result_root,
    author_profile_id,
    expected_author_profile_record_root,
    expected_author_profile_state_root,
    author_operational_key_root,
    author_delegation_root,
    expected_current_revision,
    expected_current_revision_root,
    expected_current_ast_root,
    transformed_operations_root,
    result_ast_root,
    result_revision,
    revision_root,
    outcome,
    conflict_root,
    transformed_operations_projection,
    result_ast_projection,
    conflict_projection,
    import_sequence,
    import_receipt_root,
    environment_id,
    environment_key_root,
    status
  ) VALUES (
    p_batch_record_root,
    p_transformation_record_root,
    v_document_id,
    v_batch_id,
    v_base_revision,
    v_base_ast_root,
    v_original_operations_root,
    v_expected_result_root,
    v_author.profile_id,
    v_author.current_record_root,
    v_author.current_state_root,
    v_author.operational_key_root,
    v_author.delegation_root,
    v_current_revision,
    v_current_revision_root,
    v_current_ast_root,
    v_transformed_operations_root,
    v_result_ast_root,
    v_result_revision,
    v_revision_root,
    v_outcome,
    v_conflict_root,
    p_transformed_operations_projection,
    p_result_ast_projection,
    p_conflict_projection,
    v_import_sequence,
    v_receipt_root,
    p_environment_id,
    v_environment.key_root,
    'pending-signature'
  );

  document_id := v_document_id;
  outcome := v_outcome;
  import_sequence := v_import_sequence;
  result_revision := v_result_revision;
  revision_root := v_revision_root;
  result_ast_root := v_result_ast_root;
  import_receipt_root := v_receipt_root;
  receipt_signing_payload := hestia.document_signing_payload(
    'document/import-receipt',
    v_receipt_root
  );
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION hestia.document_batch_prepare(
  text, bytea, bytea, bigint, bytea, bytea, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hestia.document_batch_prepare(
  text, bytea, bytea, bigint, bytea, bytea, jsonb, jsonb, jsonb
) TO hestia_app;

COMMENT ON FUNCTION hestia.document_batch_prepare(
  text, bytea, bytea, bigint, bytea, bytea, jsonb, jsonb, jsonb
) IS
  'Qualifies all document ledger table columns so PostgreSQL output parameters cannot shadow document_id, outcome, revision or root columns during signed OT preparation.';
