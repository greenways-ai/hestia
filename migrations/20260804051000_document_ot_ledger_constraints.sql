ALTER TABLE hestia.document_batch_admission
  ADD CONSTRAINT document_batch_admission_batch_verification_fk
    FOREIGN KEY (batch_record_root)
    REFERENCES hestia.document_record_verification(signed_record_root),
  ADD CONSTRAINT document_batch_admission_transformation_verification_fk
    FOREIGN KEY (transformation_record_root)
    REFERENCES hestia.document_record_verification(signed_record_root);

CREATE FUNCTION hestia.document_record_verification_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document verification history is append-only';
  END IF;
  IF OLD.status = 'verified' THEN
    RAISE EXCEPTION 'verified document records are immutable';
  END IF;
  IF OLD.status <> 'pending-signature'
     OR NEW.status <> 'verified'
     OR NEW.sequence <> OLD.sequence
     OR NEW.signed_record_root <> OLD.signed_record_root
     OR NEW.record_kind <> OLD.record_kind
     OR NEW.body_root <> OLD.body_root
     OR NEW.signer_key_root <> OLD.signer_key_root
     OR NEW.signature_root <> OLD.signature_root
     OR NEW.environment_id <> OLD.environment_id
     OR NEW.environment_key_root <> OLD.environment_key_root
     OR NEW.verification_receipt_root <> OLD.verification_receipt_root
     OR NEW.environment_signature_root IS NULL
     OR NEW.signed_receipt_root IS NULL
     OR NEW.verified_at IS NULL THEN
    RAISE EXCEPTION 'invalid document verification state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_record_verification_guard
BEFORE UPDATE OR DELETE ON hestia.document_record_verification
FOR EACH ROW EXECUTE FUNCTION hestia.document_record_verification_guard();

REVOKE ALL ON FUNCTION hestia.document_record_verification_guard() FROM PUBLIC;

COMMENT ON CONSTRAINT document_batch_admission_batch_verification_fk
  ON hestia.document_batch_admission IS
  'Keeps every admitted batch bound to its immutable GWDP1 verification record.';
COMMENT ON CONSTRAINT document_batch_admission_transformation_verification_fk
  ON hestia.document_batch_admission IS
  'Keeps every environment transformation bound to its immutable GWDP1 verification record.';
