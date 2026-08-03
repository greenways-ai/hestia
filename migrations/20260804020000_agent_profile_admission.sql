CREATE SEQUENCE hestia.agent_profile_admission_sequence AS bigint;

CREATE TABLE hestia.environment_agent_policy (
  environment_id text PRIMARY KEY,
  profile_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  profile_kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK ((status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE TABLE hestia.agent_key_delegation (
  delegation_id text PRIMARY KEY CHECK (length(delegation_id) BETWEEN 1 AND 256),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  issuer_profile_id text NOT NULL,
  issuer_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  subject_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  purposes text[] NOT NULL CHECK (cardinality(purposes) > 0),
  scope_profile_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  revocation_root bytea REFERENCES gw_ledger."Cell"(hash),
  admitted_by_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until > valid_from)
);

CREATE TABLE hestia.agent_profile_version (
  profile_id text NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 256),
  sequence bigint NOT NULL CHECK (sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  previous_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  root_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  delegation_root bytea NOT NULL REFERENCES hestia.agent_key_delegation(signed_record_root),
  name text NOT NULL,
  profile_kind text NOT NULL,
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (profile_id, sequence)
);

CREATE TABLE hestia.agent_profile (
  profile_id text PRIMARY KEY CHECK (length(profile_id) BETWEEN 1 AND 256),
  current_sequence bigint NOT NULL CHECK (current_sequence > 0),
  current_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  current_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  current_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  root_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  delegation_root bytea NOT NULL REFERENCES hestia.agent_key_delegation(signed_record_root),
  name text NOT NULL,
  profile_kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE hestia.agent_profile_admission (
  admission_sequence bigint PRIMARY KEY CHECK (admission_sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  profile_id text NOT NULL,
  profile_sequence bigint NOT NULL CHECK (profile_sequence > 0),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_previous_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  expected_previous_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  root_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  delegation_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  delegation_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  delegation_id text NOT NULL,
  delegation_purposes text[] NOT NULL,
  delegation_valid_from timestamptz NOT NULL,
  delegation_valid_until timestamptz NOT NULL,
  name text NOT NULL,
  profile_kind text NOT NULL,
  environment_id text NOT NULL,
  environment_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  effect_plan_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  outcome_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  environment_signature_root bytea REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea UNIQUE REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('pending-signature', 'accepted')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  UNIQUE (profile_id, profile_sequence),
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root),
  CHECK ((status = 'pending-signature'
          AND environment_signature_root IS NULL
          AND admission_signed_receipt_root IS NULL
          AND accepted_at IS NULL)
      OR (status = 'accepted'
          AND environment_signature_root IS NOT NULL
          AND admission_signed_receipt_root IS NOT NULL
          AND accepted_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION hestia.agent_record_roles(p_kind text)
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
    WHEN 'profile/state' THEN
      ARRAY['profile-id','sequence','profile-version','root-key','operational-key',
            'delegation','status']::text[]
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

CREATE FUNCTION hestia.hcv1_nil_put()
RETURNS bytea
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT hestia.hcv1_put(0, ''::bytea)
$$;

CREATE FUNCTION hestia.hcv1_is_nil(p_root bytea)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT gw_ledger.cell_type_tag(p_root) = 0
     AND (SELECT octet_length(payload) = 0
            FROM gw_ledger."Cell"
           WHERE hash = p_root)
$$;

CREATE FUNCTION hestia.hcv1_text(p_root bytea)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_payload bytea;
BEGIN
  IF gw_ledger.cell_type_tag(p_root) <> 5 THEN
    RAISE EXCEPTION 'HCV1 value is not a string';
  END IF;
  SELECT payload INTO STRICT v_payload FROM gw_ledger."Cell" WHERE hash = p_root;
  RETURN convert_from(v_payload, 'UTF8');
END;
$$;

CREATE FUNCTION hestia.hcv1_bigint(p_root bytea)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_text text;
BEGIN
  IF gw_ledger.cell_type_tag(p_root) <> 2 THEN
    RAISE EXCEPTION 'HCV1 value is not an integer';
  END IF;
  SELECT convert_from(payload, 'UTF8') INTO STRICT v_text
    FROM gw_ledger."Cell" WHERE hash = p_root;
  IF v_text !~ '^-?(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION 'invalid HCV1 integer transport';
  END IF;
  RETURN v_text::bigint;
END;
$$;

CREATE FUNCTION hestia.hcv1_map_get(p_map_root bytea, p_key text)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_ref_count integer;
  v_pair_count integer;
  v_position integer;
  v_key_root bytea;
  v_value_root bytea;
  v_found bytea;
BEGIN
  IF gw_ledger.cell_type_tag(p_map_root) <> 11 THEN
    RAISE EXCEPTION 'HCV1 value is not a map';
  END IF;
  v_ref_count := jsonb_array_length(gw_ledger.cell_ref_entries(p_map_root));
  IF mod(v_ref_count, 2) <> 0 THEN
    RAISE EXCEPTION 'HCV1 map has an invalid reference count';
  END IF;
  v_pair_count := v_ref_count / 2;
  IF v_pair_count > 0 THEN
    FOR v_position IN 0..v_pair_count - 1 LOOP
      v_key_root := gw_ledger.cell_ref_child(p_map_root, v_position, 'key');
      v_value_root := gw_ledger.cell_ref_child(p_map_root, v_position, 'value');
      IF hestia.hcv1_text(v_key_root) = p_key THEN
        IF v_found IS NOT NULL THEN
          RAISE EXCEPTION 'HCV1 map contains duplicate key: %', p_key;
        END IF;
        v_found := v_value_root;
      END IF;
    END LOOP;
  END IF;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'HCV1 map is missing key: %', p_key;
  END IF;
  RETURN v_found;
END;
$$;

CREATE FUNCTION hestia.hcv1_vector_texts(p_vector_root bytea)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_position integer;
  v_values text[] := ARRAY[]::text[];
BEGIN
  IF gw_ledger.cell_type_tag(p_vector_root) <> 10 THEN
    RAISE EXCEPTION 'HCV1 value is not a vector';
  END IF;
  v_count := jsonb_array_length(gw_ledger.cell_ref_entries(p_vector_root));
  IF v_count > 0 THEN
    FOR v_position IN 0..v_count - 1 LOOP
      v_values := array_append(
        v_values,
        hestia.hcv1_text(
          gw_ledger.cell_ref_child(p_vector_root, v_position, 'element')
        )
      );
    END LOOP;
  END IF;
  RETURN v_values;
END;
$$;

CREATE FUNCTION hestia.base64url_decode(p_value text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_base64 text;
  v_padding integer;
BEGIN
  IF p_value !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid base64url value';
  END IF;
  v_base64 := translate(p_value, '-_', '+/');
  v_padding := mod(4 - mod(length(v_base64), 4), 4);
  RETURN decode(v_base64 || repeat('=', v_padding), 'base64');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'invalid base64url value';
END;
$$;

CREATE FUNCTION hestia.hcv1_jwk_ed25519_public_key(p_jwk_root bytea)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_kty text;
  v_crv text;
  v_x text;
  v_key bytea;
BEGIN
  v_kty := hestia.hcv1_text(hestia.hcv1_map_get(p_jwk_root, 'kty'));
  v_crv := hestia.hcv1_text(hestia.hcv1_map_get(p_jwk_root, 'crv'));
  v_x := hestia.hcv1_text(hestia.hcv1_map_get(p_jwk_root, 'x'));
  IF v_kty <> 'OKP' OR v_crv <> 'Ed25519' THEN
    RAISE EXCEPTION 'JWK is not an Ed25519 OKP key';
  END IF;
  v_key := hestia.base64url_decode(v_x);
  IF octet_length(v_key) <> 32 THEN
    RAISE EXCEPTION 'Ed25519 JWK x must decode to 32 bytes';
  END IF;
  RETURN v_key;
END;
$$;

CREATE FUNCTION hestia.hcv1_key_descriptor(
  p_descriptor_root bytea,
  OUT key_id text,
  OUT public_key bytea,
  OUT key_root bytea
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwk_root bytea;
BEGIN
  key_id := hestia.hcv1_text(hestia.hcv1_map_get(p_descriptor_root, 'id'));
  v_jwk_root := hestia.hcv1_map_get(p_descriptor_root, 'public_jwk');
  public_key := hestia.hcv1_jwk_ed25519_public_key(v_jwk_root);
  key_root := hestia.hcv1_blob_put(public_key);
  IF key_id <> 'ed25519:' || encode(key_root, 'hex') THEN
    RAISE EXCEPTION 'Ed25519 key identifier does not match its canonical key root';
  END IF;
END;
$$;

CREATE FUNCTION hestia.agent_signed_record_check(
  p_signed_record_root bytea,
  p_record_kind text,
  OUT body_root bytea,
  OUT signer_key_root bytea,
  OUT signature_root bytea
)
RETURNS record
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
  IF gw_ledger.cell_type_tag(p_signed_record_root) <> 14 THEN
    RAISE EXCEPTION 'submitted root is not an HCV1 signed record';
  END IF;
  IF jsonb_array_length(gw_ledger.cell_ref_entries(p_signed_record_root)) <> 3 THEN
    RAISE EXCEPTION 'signed record must contain exactly three references';
  END IF;
  body_root := gw_ledger.cell_ref_child(p_signed_record_root, 0, 'body');
  signer_key_root := gw_ledger.cell_ref_child(p_signed_record_root, 1, 'signer-key');
  signature_root := gw_ledger.cell_ref_child(p_signed_record_root, 2, 'signature');
  v_expected := 'R:hestia-agent/1:ledger/signed-record:1:3:'
                || encode(body_root, 'hex')
                || encode(signer_key_root, 'hex')
                || encode(signature_root, 'hex');
  SELECT payload INTO STRICT v_payload
    FROM gw_ledger."Cell" WHERE hash = p_signed_record_root;
  IF v_payload <> convert_to(v_expected, 'UTF8') THEN
    RAISE EXCEPTION 'signed record payload/reference mismatch';
  END IF;
  PERFORM hestia.agent_record_validate_body(p_record_kind, body_root);
  IF gw_ledger.cell_type_tag(signer_key_root) <> 6
     OR gw_ledger.cell_type_tag(signature_root) <> 6 THEN
    RAISE EXCEPTION 'signed record key and signature must be HCV1 blob cells';
  END IF;
  SELECT payload INTO STRICT v_public_key
    FROM gw_ledger."Cell" WHERE hash = signer_key_root;
  SELECT payload INTO STRICT v_signature
    FROM gw_ledger."Cell" WHERE hash = signature_root;
  IF octet_length(v_public_key) <> 32 OR octet_length(v_signature) <> 64 THEN
    RAISE EXCEPTION 'invalid Ed25519 key or signature width';
  END IF;
  IF NOT gw_ledger.signature_verify(
    v_signature,
    convert_to('GWAR1:' || p_record_kind || ':' || encode(body_root, 'hex'), 'UTF8'),
    v_public_key
  ) THEN
    RAISE EXCEPTION 'invalid GWAR1 agent record signature';
  END IF;
END;
$$;

CREATE FUNCTION hestia.environment_agent_policy_register(
  p_environment_id text,
  p_profile_policy_root bytea,
  p_profile_kernel_root bytea
)
RETURNS TABLE (profile_policy_root bytea, profile_kernel_root bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.environment_agent_policy%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hestia.environment_signer
     WHERE environment_id = p_environment_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Hestia environment has no active signing key';
  END IF;
  IF p_profile_policy_root IS NULL OR p_profile_kernel_root IS NULL
     OR octet_length(p_profile_policy_root) <> 32
     OR octet_length(p_profile_kernel_root) <> 32 THEN
    RAISE EXCEPTION 'profile policy and kernel must be HCV1 roots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_profile_policy_root)
     OR NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_profile_kernel_root) THEN
    RAISE EXCEPTION 'profile policy and kernel cells must already exist';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_environment_id, 1));
  SELECT * INTO v_existing
    FROM hestia.environment_agent_policy
   WHERE environment_id = p_environment_id;
  IF FOUND THEN
    IF v_existing.status <> 'active'
       OR v_existing.profile_policy_root <> p_profile_policy_root
       OR v_existing.profile_kernel_root <> p_profile_kernel_root THEN
      RAISE EXCEPTION 'Hestia environment profile policy conflict';
    END IF;
  ELSE
    INSERT INTO hestia.environment_agent_policy (
      environment_id, profile_policy_root, profile_kernel_root, status
    ) VALUES (
      p_environment_id, p_profile_policy_root, p_profile_kernel_root, 'active'
    );
  END IF;
  profile_policy_root := p_profile_policy_root;
  profile_kernel_root := p_profile_kernel_root;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_profile_admit_prepare(
  p_environment_id text,
  p_signed_record_root bytea
)
RETURNS TABLE (
  admission_sequence bigint,
  profile_id text,
  profile_sequence bigint,
  result_state_root bytea,
  admission_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_profile_admission%ROWTYPE;
  v_verification hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_policy hestia.environment_agent_policy%ROWTYPE;
  v_current hestia.agent_profile%ROWTYPE;
  v_body_root bytea;
  v_profile_id text;
  v_profile_sequence bigint;
  v_previous_field bytea;
  v_previous_record_root bytea;
  v_previous_state_root bytea;
  v_name text;
  v_profile_kind text;
  v_root_descriptor bytea;
  v_operational_descriptor bytea;
  v_root_key_id text;
  v_root_public_key bytea;
  v_root_key_root bytea;
  v_operational_key_id text;
  v_operational_public_key bytea;
  v_operational_key_root bytea;
  v_delegation_root bytea;
  v_delegation_body_root bytea;
  v_delegation_signer_root bytea;
  v_delegation_signature_root bytea;
  v_delegation_id text;
  v_issuer_profile_id text;
  v_issuer_key_id text;
  v_subject_key_id text;
  v_subject_public_key bytea;
  v_subject_key_root bytea;
  v_purposes text[];
  v_scope_root bytea;
  v_scope_profile_id text;
  v_valid_from timestamptz;
  v_valid_until timestamptz;
  v_revocation_root bytea;
  v_status_root bytea;
  v_effect_plan_root bytea;
  v_outcome_root bytea;
  v_admission_sequence bigint;
  v_admission_sequence_root bytea;
  v_result_state_root bytea;
  v_admission_receipt_root bytea;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.agent_profile_admission
   WHERE signed_record_root = p_signed_record_root;
  IF FOUND THEN
    admission_sequence := v_existing.admission_sequence;
    profile_id := v_existing.profile_id;
    profile_sequence := v_existing.profile_sequence;
    result_state_root := v_existing.result_state_root;
    admission_receipt_root := v_existing.admission_receipt_root;
    receipt_signing_payload := convert_to(
      'GWAR1:ledger/admission-receipt:'
      || encode(v_existing.admission_receipt_root, 'hex'),
      'UTF8'
    );
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_verification
    FROM hestia.agent_record_verification
   WHERE signed_record_root = p_signed_record_root
     AND record_kind = 'profile/version'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile record requires a verified Hestia receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = v_verification.environment_key_root
     AND status = 'active';
  SELECT * INTO STRICT v_policy
    FROM hestia.environment_agent_policy
   WHERE environment_id = p_environment_id
     AND status = 'active';

  v_body_root := v_verification.body_root;
  v_profile_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 0, 'profile-id')
  );
  v_profile_sequence := hestia.hcv1_bigint(
    gw_ledger.cell_ref_child(v_body_root, 1, 'sequence')
  );
  v_previous_field := gw_ledger.cell_ref_child(v_body_root, 2, 'previous-profile');
  v_previous_record_root := CASE
    WHEN hestia.hcv1_is_nil(v_previous_field) THEN NULL
    ELSE v_previous_field
  END;
  v_name := hestia.hcv1_text(gw_ledger.cell_ref_child(v_body_root, 3, 'name'));
  v_profile_kind := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 4, 'profile-kind')
  );
  IF length(v_profile_id) NOT BETWEEN 1 AND 256
     OR length(v_name) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'profile identifier or name is outside the admission bound';
  END IF;
  IF v_profile_kind NOT IN ('agent', 'human', 'organization') THEN
    RAISE EXCEPTION 'unsupported Hestia profile kind: %', v_profile_kind;
  END IF;

  v_root_descriptor := gw_ledger.cell_ref_child(v_body_root, 5, 'root-key');
  SELECT key_id, public_key, key_root
    INTO v_root_key_id, v_root_public_key, v_root_key_root
    FROM hestia.hcv1_key_descriptor(v_root_descriptor);
  IF v_root_key_root <> v_verification.signer_key_root THEN
    RAISE EXCEPTION 'profile root-key descriptor does not match its signer';
  END IF;

  v_operational_descriptor := gw_ledger.cell_ref_child(
    v_body_root, 6, 'operational-key'
  );
  SELECT key_id, public_key, key_root
    INTO v_operational_key_id, v_operational_public_key, v_operational_key_root
    FROM hestia.hcv1_key_descriptor(v_operational_descriptor);

  v_delegation_root := gw_ledger.cell_ref_child(v_body_root, 7, 'delegation');
  SELECT body_root, signer_key_root, signature_root
    INTO v_delegation_body_root, v_delegation_signer_root,
         v_delegation_signature_root
    FROM hestia.agent_signed_record_check(
      v_delegation_root,
      'profile/key-delegation'
    );
  IF v_delegation_signer_root <> v_root_key_root THEN
    RAISE EXCEPTION 'profile delegation is not signed by the profile root key';
  END IF;

  v_delegation_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_delegation_body_root, 0, 'delegation-id')
  );
  v_issuer_profile_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_delegation_body_root, 1, 'issuer-profile')
  );
  v_issuer_key_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_delegation_body_root, 2, 'issuer-key')
  );
  v_subject_key_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_delegation_body_root, 3, 'subject-key')
  );
  v_subject_public_key := hestia.hcv1_jwk_ed25519_public_key(
    gw_ledger.cell_ref_child(v_delegation_body_root, 4, 'subject-public-key')
  );
  v_subject_key_root := hestia.hcv1_blob_put(v_subject_public_key);
  v_purposes := hestia.hcv1_vector_texts(
    gw_ledger.cell_ref_child(v_delegation_body_root, 5, 'purposes')
  );
  v_scope_root := gw_ledger.cell_ref_child(v_delegation_body_root, 6, 'scope');
  v_scope_profile_id := hestia.hcv1_text(
    hestia.hcv1_map_get(v_scope_root, 'profile_id')
  );
  BEGIN
    v_valid_from := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_delegation_body_root, 7, 'valid-from')
    )::timestamptz;
    v_valid_until := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_delegation_body_root, 8, 'valid-until')
    )::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'profile delegation has an invalid validity interval';
  END;
  v_revocation_root := gw_ledger.cell_ref_child(
    v_delegation_body_root, 9, 'revocation'
  );

  IF v_issuer_profile_id <> v_profile_id
     OR v_scope_profile_id <> v_profile_id THEN
    RAISE EXCEPTION 'profile delegation scope does not match the profile';
  END IF;
  IF v_issuer_key_id <> v_root_key_id
     OR v_subject_key_id <> v_operational_key_id
     OR v_subject_key_root <> v_operational_key_root
     OR v_subject_public_key <> v_operational_public_key THEN
    RAISE EXCEPTION 'profile delegation key binding mismatch';
  END IF;
  IF NOT ('profile.update' = ANY(v_purposes)) THEN
    RAISE EXCEPTION 'profile operational key lacks profile.update authority';
  END IF;
  IF NOT hestia.hcv1_is_nil(v_revocation_root) THEN
    RAISE EXCEPTION 'profile delegation is revoked';
  END IF;
  IF v_valid_until <= v_valid_from
     OR clock_timestamp() < v_valid_from
     OR clock_timestamp() > v_valid_until THEN
    RAISE EXCEPTION 'profile delegation is not currently valid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_profile_id, 2));
  SELECT * INTO v_current
    FROM hestia.agent_profile
   WHERE profile_id = v_profile_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_profile_sequence <> v_current.current_sequence + 1
       OR v_previous_record_root IS DISTINCT FROM v_current.current_record_root THEN
      RAISE EXCEPTION 'profile version does not extend the current head';
    END IF;
    IF v_root_key_root <> v_current.root_key_root THEN
      RAISE EXCEPTION 'profile root-key rotation requires a separate recovery transition';
    END IF;
    v_previous_state_root := v_current.current_state_root;
  ELSE
    IF v_profile_sequence <> 1 OR v_previous_record_root IS NOT NULL THEN
      RAISE EXCEPTION 'profile genesis must have sequence one and no predecessor';
    END IF;
    v_previous_state_root := hestia.hcv1_nil_put();
  END IF;

  v_admission_sequence := nextval('hestia.agent_profile_admission_sequence'::regclass);
  v_status_root := hestia.hcv1_string_put('active');
  v_effect_plan_root := hestia.hcv1_string_put('profile-head-advance');
  v_outcome_root := hestia.hcv1_string_put('accepted');
  v_admission_sequence_root := hestia.hcv1_integer_put(v_admission_sequence);
  v_result_state_root := hestia.agent_record_put(
    'profile/state',
    ARRAY[
      gw_ledger.cell_ref_child(v_body_root, 0, 'profile-id'),
      gw_ledger.cell_ref_child(v_body_root, 1, 'sequence'),
      p_signed_record_root,
      v_root_key_root,
      v_operational_key_root,
      v_delegation_root,
      v_status_root
    ]::bytea[]
  );
  v_admission_receipt_root := hestia.agent_record_put(
    'ledger/admission-receipt',
    ARRAY[
      v_previous_state_root,
      v_body_root,
      v_policy.profile_policy_root,
      v_policy.profile_kernel_root,
      v_result_state_root,
      v_effect_plan_root,
      p_signed_record_root,
      v_outcome_root,
      v_admission_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_profile_admission (
    admission_sequence,
    signed_record_root,
    profile_id,
    profile_sequence,
    body_root,
    verification_signed_receipt_root,
    expected_previous_record_root,
    expected_previous_state_root,
    result_state_root,
    root_key_root,
    operational_key_root,
    delegation_root,
    delegation_body_root,
    delegation_id,
    delegation_purposes,
    delegation_valid_from,
    delegation_valid_until,
    name,
    profile_kind,
    environment_id,
    environment_key_root,
    policy_root,
    kernel_root,
    effect_plan_root,
    outcome_root,
    admission_receipt_root,
    status
  ) VALUES (
    v_admission_sequence,
    p_signed_record_root,
    v_profile_id,
    v_profile_sequence,
    v_body_root,
    v_verification.signed_receipt_root,
    v_previous_record_root,
    v_previous_state_root,
    v_result_state_root,
    v_root_key_root,
    v_operational_key_root,
    v_delegation_root,
    v_delegation_body_root,
    v_delegation_id,
    v_purposes,
    v_valid_from,
    v_valid_until,
    v_name,
    v_profile_kind,
    p_environment_id,
    v_environment.key_root,
    v_policy.profile_policy_root,
    v_policy.profile_kernel_root,
    v_effect_plan_root,
    v_outcome_root,
    v_admission_receipt_root,
    'pending-signature'
  );

  admission_sequence := v_admission_sequence;
  profile_id := v_profile_id;
  profile_sequence := v_profile_sequence;
  result_state_root := v_result_state_root;
  admission_receipt_root := v_admission_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR1:ledger/admission-receipt:' || encode(v_admission_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_profile_admit_commit(
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
  v_row hestia.agent_profile_admission%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_current hestia.agent_profile%ROWTYPE;
  v_existing_delegation hestia.agent_key_delegation%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_signing_payload bytea;
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_profile_admission
   WHERE signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile record has not been prepared for admission';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'profile admission was prepared for another environment';
  END IF;
  IF v_row.status = 'accepted' THEN
    RETURN v_row.admission_signed_receipt_root;
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
    RAISE EXCEPTION 'Hestia admission receipt requires a 64-byte Ed25519 signature';
  END IF;
  v_signing_payload := convert_to(
    'GWAR1:ledger/admission-receipt:'
    || encode(v_row.admission_receipt_root, 'hex'),
    'UTF8'
  );
  IF NOT gw_ledger.signature_verify(
    p_environment_signature,
    v_signing_payload,
    v_environment.public_key
  ) THEN
    RAISE EXCEPTION 'invalid Hestia profile admission signature';
  END IF;

  SELECT * INTO v_current
    FROM hestia.agent_profile
   WHERE profile_id = v_row.profile_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_current.current_record_root IS DISTINCT FROM v_row.expected_previous_record_root
       OR v_current.current_state_root <> v_row.expected_previous_state_root
       OR v_current.current_sequence + 1 <> v_row.profile_sequence THEN
      RAISE EXCEPTION 'profile head changed after admission preparation';
    END IF;
  ELSE
    IF v_row.expected_previous_record_root IS NOT NULL
       OR NOT hestia.hcv1_is_nil(v_row.expected_previous_state_root)
       OR v_row.profile_sequence <> 1 THEN
      RAISE EXCEPTION 'profile genesis state changed after admission preparation';
    END IF;
  END IF;

  SELECT * INTO v_existing_delegation
    FROM hestia.agent_key_delegation
   WHERE delegation_id = v_row.delegation_id;
  IF FOUND THEN
    IF v_existing_delegation.signed_record_root <> v_row.delegation_root
       OR v_existing_delegation.issuer_profile_id <> v_row.profile_id
       OR v_existing_delegation.subject_key_root <> v_row.operational_key_root THEN
      RAISE EXCEPTION 'delegation identifier already belongs to another record';
    END IF;
  ELSE
    INSERT INTO hestia.agent_key_delegation (
      delegation_id,
      signed_record_root,
      body_root,
      issuer_profile_id,
      issuer_key_root,
      subject_key_root,
      purposes,
      scope_profile_id,
      valid_from,
      valid_until,
      revocation_root,
      admitted_by_profile_record_root
    ) VALUES (
      v_row.delegation_id,
      v_row.delegation_root,
      v_row.delegation_body_root,
      v_row.profile_id,
      v_row.root_key_root,
      v_row.operational_key_root,
      v_row.delegation_purposes,
      v_row.profile_id,
      v_row.delegation_valid_from,
      v_row.delegation_valid_until,
      NULL,
      v_row.signed_record_root
    );
  END IF;

  v_signature_root := hestia.hcv1_blob_put(p_environment_signature);
  v_signed_receipt_root := hestia.agent_record_put(
    'ledger/signed-record',
    ARRAY[
      v_row.admission_receipt_root,
      v_row.environment_key_root,
      v_signature_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_profile_version (
    profile_id,
    sequence,
    signed_record_root,
    body_root,
    previous_record_root,
    state_root,
    root_key_root,
    operational_key_root,
    delegation_root,
    name,
    profile_kind,
    verification_signed_receipt_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.profile_id,
    v_row.profile_sequence,
    v_row.signed_record_root,
    v_row.body_root,
    v_row.expected_previous_record_root,
    v_row.result_state_root,
    v_row.root_key_root,
    v_row.operational_key_root,
    v_row.delegation_root,
    v_row.name,
    v_row.profile_kind,
    v_row.verification_signed_receipt_root,
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_profile (
    profile_id,
    current_sequence,
    current_record_root,
    current_body_root,
    current_state_root,
    root_key_root,
    operational_key_root,
    delegation_root,
    name,
    profile_kind,
    status,
    admission_signed_receipt_root
  ) VALUES (
    v_row.profile_id,
    v_row.profile_sequence,
    v_row.signed_record_root,
    v_row.body_root,
    v_row.result_state_root,
    v_row.root_key_root,
    v_row.operational_key_root,
    v_row.delegation_root,
    v_row.name,
    v_row.profile_kind,
    'active',
    v_signed_receipt_root
  )
  ON CONFLICT (profile_id) DO UPDATE
    SET current_sequence = EXCLUDED.current_sequence,
        current_record_root = EXCLUDED.current_record_root,
        current_body_root = EXCLUDED.current_body_root,
        current_state_root = EXCLUDED.current_state_root,
        operational_key_root = EXCLUDED.operational_key_root,
        delegation_root = EXCLUDED.delegation_root,
        name = EXCLUDED.name,
        profile_kind = EXCLUDED.profile_kind,
        status = EXCLUDED.status,
        admission_signed_receipt_root = EXCLUDED.admission_signed_receipt_root,
        updated_at = clock_timestamp();

  UPDATE hestia.agent_profile_admission
     SET environment_signature_root = v_signature_root,
         admission_signed_receipt_root = v_signed_receipt_root,
         status = 'accepted',
         accepted_at = clock_timestamp()
   WHERE signed_record_root = p_signed_record_root;

  RETURN v_signed_receipt_root;
END;
$$;

CREATE TRIGGER agent_key_delegation_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_key_delegation
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER agent_profile_version_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_profile_version
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

REVOKE ALL ON hestia.environment_agent_policy FROM PUBLIC;
REVOKE ALL ON hestia.agent_key_delegation FROM PUBLIC;
REVOKE ALL ON hestia.agent_profile_version FROM PUBLIC;
REVOKE ALL ON hestia.agent_profile FROM PUBLIC;
REVOKE ALL ON hestia.agent_profile_admission FROM PUBLIC;
REVOKE ALL ON SEQUENCE hestia.agent_profile_admission_sequence FROM PUBLIC;

REVOKE ALL ON FUNCTION hestia.hcv1_nil_put() FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_is_nil(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_text(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_bigint(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_map_get(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_vector_texts(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.base64url_decode(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_jwk_ed25519_public_key(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_key_descriptor(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_signed_record_check(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.environment_agent_policy_register(text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_profile_admit_prepare(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_profile_admit_commit(text, bytea, bytea) FROM PUBLIC;

GRANT SELECT ON hestia.agent_key_delegation TO hestia_app;
GRANT SELECT ON hestia.agent_profile_version TO hestia_app;
GRANT SELECT ON hestia.agent_profile TO hestia_app;
GRANT SELECT ON hestia.agent_profile_admission TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_profile_admit_prepare(text, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_profile_admit_commit(text, bytea, bytea) TO hestia_app;

COMMENT ON TABLE hestia.agent_profile IS
  'Current projection of HCV1 agent profile state; authoritative history remains in agent_profile_version and signed admission receipts.';
COMMENT ON FUNCTION hestia.agent_profile_admit_prepare(text, bytea) IS
  'Decodes a verified profile and root-signed delegation, enforces key binding and sequence continuity, then returns exact environment signing bytes for the admission receipt.';
COMMENT ON FUNCTION hestia.agent_profile_admit_commit(text, bytea, bytea) IS
  'Rechecks the profile head, verifies the environment admission signature, and atomically advances the append-only profile projection.';
