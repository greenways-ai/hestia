CREATE OR REPLACE FUNCTION hestia.document_batch_commit(
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
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified document batch disappeared before commit';
  END IF;

  SELECT * INTO v_transform_verification
    FROM hestia.document_record_verification
   WHERE signed_record_root = v_row.transformation_record_root
     AND record_kind = 'document/transformation'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified document transformation disappeared before commit';
  END IF;

  IF v_batch_verification.signer_key_root <> v_row.author_operational_key_root
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
          v_row.transformed_operations_root,
          v_index,
          'element'
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

REVOKE ALL ON FUNCTION hestia.document_batch_commit(text, bytea, bytea, bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hestia.document_batch_commit(text, bytea, bytea, bytea)
  TO hestia_app;

COMMENT ON FUNCTION hestia.document_batch_commit(text, bytea, bytea, bytea) IS
  'Rechecks the exact head, delegated author, verified contributor batch and verified environment transformation independently before atomically appending the signed document revision or conflict receipt.';
