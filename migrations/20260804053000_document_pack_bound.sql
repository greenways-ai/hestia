CREATE OR REPLACE FUNCTION hestia.document_record_verify_prepare(
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
  -- Document packs contain the canonical base/result AST trees and the
  -- independently rooted operation vector. They remain bounded to 1 MB and 64
  -- operations, but need a larger cell allowance than compact agent records.
  IF p_pack IS NULL OR octet_length(p_pack) > 1000000
     OR p_cell_count IS NULL OR p_cell_count < 1 OR p_cell_count > 512 THEN
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

REVOKE ALL ON FUNCTION hestia.document_record_verify_prepare(
  text, bytea, bigint, bytea, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hestia.document_record_verify_prepare(
  text, bytea, bigint, bytea, text
) TO hestia_app;

COMMENT ON FUNCTION hestia.document_record_verify_prepare(
  text, bytea, bigint, bytea, text
) IS
  'Imports and verifies a bounded document record pack. Document HCP1 packs permit at most 512 canonical cells and 1 MB; batches remain limited to 64 operations.';
