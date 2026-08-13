ALTER TABLE hestia.agent_room
  ADD COLUMN authority_policy_revision bigint NOT NULL DEFAULT 1
    CHECK (authority_policy_revision > 0),
  ADD COLUMN authority_sequence bigint NOT NULL DEFAULT 0
    CHECK (authority_sequence >= 0),
  ADD COLUMN authority_head_root bytea REFERENCES gw_ledger."Cell"(hash),
  ADD CONSTRAINT agent_room_authority_head_consistent
    CHECK ((authority_sequence = 0 AND authority_head_root IS NULL)
        OR (authority_sequence > 0 AND authority_head_root IS NOT NULL));

CREATE TABLE hestia.agent_room_authority (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  authority_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  previous_authority_root bytea REFERENCES gw_ledger."Cell"(hash),
  room_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  event_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  event_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  authority_kind text NOT NULL CHECK (authority_kind IN (
    'source-mandate',
    'source-mandate-revocation',
    'application-grant',
    'application-grant-revocation'
  )),
  actor_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  actor_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  policy_revision bigint NOT NULL CHECK (policy_revision > 0),
  effect_plan_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, sequence)
);

CREATE TABLE hestia.agent_room_source_mandate (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  mandate_id text NOT NULL CHECK (length(mandate_id) BETWEEN 1 AND 240),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  governance_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  authority_sequence bigint NOT NULL,
  authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  issued_by_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  issued_by_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  issuer_authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 240),
  source_node_id text NOT NULL CHECK (length(source_node_id) BETWEEN 1 AND 240),
  implementation text NOT NULL CHECK (length(implementation) BETWEEN 1 AND 240),
  application_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  app_id text NOT NULL CHECK (length(app_id) BETWEEN 1 AND 240),
  app_version text NOT NULL CHECK (length(app_version) BETWEEN 1 AND 100),
  publisher_id text NOT NULL CHECK (length(publisher_id) BETWEEN 1 AND 240),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  lock_digest text CHECK (lock_digest IS NULL OR lock_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_digest text NOT NULL CHECK (approval_digest ~ '^sha256:[0-9a-f]{64}$'),
  operations text[] NOT NULL CHECK (cardinality(operations) BETWEEN 1 AND 64),
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  policy_revision bigint NOT NULL CHECK (policy_revision > 0),
  requires_user_interaction boolean NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revocation_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  revoked_at timestamptz,
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, mandate_id),
  FOREIGN KEY (room_id, authority_sequence)
    REFERENCES hestia.agent_room_authority(room_id, sequence),
  CHECK (valid_until > valid_from),
  CHECK ((status = 'active' AND revocation_record_root IS NULL AND revoked_at IS NULL)
      OR (status = 'revoked' AND revocation_record_root IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX agent_room_one_active_source_mandate_idx
  ON hestia.agent_room_source_mandate (room_id, source_id)
  WHERE status = 'active';

CREATE TABLE hestia.agent_room_source_mandate_revocation (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  revocation_id text NOT NULL CHECK (length(revocation_id) BETWEEN 1 AND 240),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  governance_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  mandate_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  authority_sequence bigint NOT NULL,
  authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  revoked_by_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  revoked_by_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  revoker_authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 160),
  revoked_at timestamptz NOT NULL,
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, revocation_id),
  FOREIGN KEY (room_id, authority_sequence)
    REFERENCES hestia.agent_room_authority(room_id, sequence),
  FOREIGN KEY (mandate_record_root)
    REFERENCES hestia.agent_room_source_mandate(signed_record_root)
);

CREATE TABLE hestia.agent_room_application_grant (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  grant_id text NOT NULL CHECK (length(grant_id) BETWEEN 1 AND 240),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  governance_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  authority_sequence bigint NOT NULL,
  authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  issued_by_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  issued_by_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  issuer_authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  member_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  member_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  member_node_id text CHECK (member_node_id IS NULL OR length(member_node_id) BETWEEN 1 AND 240),
  source_mandate_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  application_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  app_id text NOT NULL CHECK (length(app_id) BETWEEN 1 AND 240),
  app_version text NOT NULL CHECK (length(app_version) BETWEEN 1 AND 100),
  publisher_id text NOT NULL CHECK (length(publisher_id) BETWEEN 1 AND 240),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  lock_digest text CHECK (lock_digest IS NULL OR lock_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_digest text NOT NULL CHECK (approval_digest ~ '^sha256:[0-9a-f]{64}$'),
  operations text[] NOT NULL CHECK (cardinality(operations) BETWEEN 1 AND 64),
  requests_per_day bigint NOT NULL CHECK (requests_per_day BETWEEN 1 AND 1000000),
  max_input_bytes bigint NOT NULL CHECK (max_input_bytes BETWEEN 1 AND 16777216),
  max_output_bytes bigint NOT NULL CHECK (max_output_bytes BETWEEN 1 AND 16777216),
  max_timeout_ms bigint NOT NULL CHECK (max_timeout_ms BETWEEN 1 AND 86400000),
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  policy_revision bigint NOT NULL CHECK (policy_revision > 0),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revocation_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  revoked_at timestamptz,
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, grant_id),
  FOREIGN KEY (room_id, authority_sequence)
    REFERENCES hestia.agent_room_authority(room_id, sequence),
  FOREIGN KEY (source_mandate_record_root)
    REFERENCES hestia.agent_room_source_mandate(signed_record_root),
  CHECK (valid_until > valid_from),
  CHECK ((status = 'active' AND revocation_record_root IS NULL AND revoked_at IS NULL)
      OR (status = 'revoked' AND revocation_record_root IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE TABLE hestia.agent_room_application_grant_revocation (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  revocation_id text NOT NULL CHECK (length(revocation_id) BETWEEN 1 AND 240),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  governance_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  grant_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  authority_sequence bigint NOT NULL,
  authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  revoked_by_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  revoked_by_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  revoker_authority_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 160),
  revoked_at timestamptz NOT NULL,
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, revocation_id),
  FOREIGN KEY (room_id, authority_sequence)
    REFERENCES hestia.agent_room_authority(room_id, sequence),
  FOREIGN KEY (grant_record_root)
    REFERENCES hestia.agent_room_application_grant(signed_record_root)
);

CREATE TABLE hestia.agent_room_authority_admission (
  admission_sequence bigint PRIMARY KEY CHECK (admission_sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  record_kind text NOT NULL CHECK (record_kind IN (
    'room/source-mandate',
    'room/source-mandate-revocation',
    'room/application-grant',
    'room/application-grant-revocation'
  )),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  room_id text NOT NULL,
  expected_room_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_room_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_membership_epoch bigint NOT NULL CHECK (expected_membership_epoch > 0),
  expected_policy_revision bigint NOT NULL CHECK (expected_policy_revision > 0),
  expected_authority_sequence bigint NOT NULL CHECK (expected_authority_sequence >= 0),
  expected_authority_head_root bytea REFERENCES gw_ledger."Cell"(hash),
  actor_profile_id text NOT NULL,
  expected_actor_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_actor_profile_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  actor_operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  actor_delegation_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  required_purpose text NOT NULL CHECK (required_purpose IN (
    'room.source.manage',
    'room.app.grant'
  )),
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 240),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  authority_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  effect_plan_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  outcome_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  environment_id text NOT NULL,
  environment_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  environment_signature_root bytea REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea UNIQUE REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('pending-signature', 'accepted')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  FOREIGN KEY (environment_id, environment_key_root)
    REFERENCES hestia.environment_signer(environment_id, key_root),
  CHECK ((record_kind IN (
           'room/source-mandate',
           'room/source-mandate-revocation'
         ) AND required_purpose = 'room.source.manage')
      OR (record_kind IN (
           'room/application-grant',
           'room/application-grant-revocation'
         ) AND required_purpose = 'room.app.grant')),
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
    WHEN 'room/member-state' THEN
      ARRAY['room','member-profile','role','purposes','status','joined-epoch',
            'revoked-epoch','delegation']::text[]
    WHEN 'room/invitation-state' THEN
      ARRAY['invitation','room-state','status','consumed-by','consumed-record']::text[]
    WHEN 'room/state' THEN
      ARRAY['room-id','room-version','host-profile','membership-epoch','members',
            'invitations','policy','kernel','acceptance-mode','status']::text[]
    WHEN 'room/activity-state' THEN
      ARRAY['room-state','previous-activity','event','activity-kind',
            'actor-profile','membership-epoch','sequence']::text[]
    WHEN 'room/authority-state' THEN
      ARRAY['room-state','previous-authority','event','authority-kind',
            'membership-epoch','policy-revision','sequence']::text[]
    WHEN 'room/source-mandate' THEN
      ARRAY['mandate-id','room','governance','issued-by','authority','source-id',
            'source-node','implementation','application','operations',
            'membership-epoch','policy-revision','requires-user-interaction',
            'valid-from','valid-until']::text[]
    WHEN 'room/source-mandate-revocation' THEN
      ARRAY['revocation-id','room','governance','mandate','revoked-by','authority',
            'reason','revoked-at']::text[]
    WHEN 'room/application-grant' THEN
      ARRAY['grant-id','room','governance','issued-by','authority','member-profile',
            'member-node','source-mandate','application','operations','limits',
            'membership-epoch','policy-revision','valid-from','valid-until']::text[]
    WHEN 'room/application-grant-revocation' THEN
      ARRAY['revocation-id','room','governance','grant','revoked-by','authority',
            'reason','revoked-at']::text[]
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

CREATE OR REPLACE FUNCTION hestia.agent_record_submittable(p_kind text)
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
    'room/source-mandate',
    'room/source-mandate-revocation',
    'room/application-grant',
    'room/application-grant-revocation',
    'room/message',
    'room/message-intent',
    'document/version',
    'room/document-attachment',
    'negotiation/offer',
    'negotiation/acceptance'
  ]::text[])
$$;

CREATE FUNCTION hestia.hcv1_map_keys(p_map_root bytea)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_ref_count integer;
  v_pair_count integer;
  v_position integer;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF gw_ledger.cell_type_tag(p_map_root) <> 11 THEN
    RAISE EXCEPTION 'HCV0 value is not a map';
  END IF;
  v_ref_count := jsonb_array_length(gw_ledger.cell_ref_entries(p_map_root));
  IF mod(v_ref_count, 2) <> 0 THEN
    RAISE EXCEPTION 'HCV0 map has an invalid reference count';
  END IF;
  v_pair_count := v_ref_count / 2;
  IF v_pair_count > 0 THEN
    FOR v_position IN 0..v_pair_count - 1 LOOP
      v_keys := array_append(
        v_keys,
        hestia.hcv1_text(
          gw_ledger.cell_ref_child(p_map_root, v_position, 'key')
        )
      );
    END LOOP;
  END IF;
  IF cardinality(v_keys) <> (
    SELECT count(DISTINCT value) FROM unnest(v_keys) AS item(value)
  ) THEN
    RAISE EXCEPTION 'HCV0 map contains duplicate keys';
  END IF;
  RETURN v_keys;
END;
$$;

CREATE FUNCTION hestia.hcv1_map_require_keys(
  p_map_root bytea,
  p_expected text[]
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_actual text[];
  v_actual_sorted text[];
  v_expected_sorted text[];
BEGIN
  v_actual := hestia.hcv1_map_keys(p_map_root);
  SELECT array_agg(value ORDER BY value COLLATE "C") INTO v_actual_sorted
    FROM unnest(v_actual) AS item(value);
  SELECT array_agg(value ORDER BY value COLLATE "C") INTO v_expected_sorted
    FROM unnest(p_expected) AS item(value);
  IF cardinality(v_actual) <> cardinality(p_expected)
     OR v_actual_sorted IS DISTINCT FROM v_expected_sorted THEN
    RAISE EXCEPTION 'HCV0 map fields do not match the closed schema';
  END IF;
END;
$$;

CREATE FUNCTION hestia.hcv1_bounded_text(
  p_root bytea,
  p_name text,
  p_maximum integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_value text;
BEGIN
  v_value := hestia.hcv1_text(p_root);
  IF length(v_value) NOT BETWEEN 1 AND p_maximum
     OR btrim(v_value) <> v_value
     OR v_value ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '% is outside the Hestia authority bound', p_name;
  END IF;
  RETURN v_value;
END;
$$;

CREATE FUNCTION hestia.hcv1_optional_bounded_text(
  p_root bytea,
  p_name text,
  p_maximum integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF hestia.hcv1_is_nil(p_root) THEN
    RETURN NULL;
  END IF;
  RETURN hestia.hcv1_bounded_text(p_root, p_name, p_maximum);
END;
$$;

CREATE FUNCTION hestia.hcv1_digest_text(p_root bytea, p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_value text;
BEGIN
  v_value := hestia.hcv1_text(p_root);
  IF v_value !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '% is not a lowercase SHA-256 digest', p_name;
  END IF;
  RETURN v_value;
END;
$$;

CREATE FUNCTION hestia.hcv1_optional_digest_text(p_root bytea, p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF hestia.hcv1_is_nil(p_root) THEN
    RETURN NULL;
  END IF;
  RETURN hestia.hcv1_digest_text(p_root, p_name);
END;
$$;

CREATE FUNCTION hestia.hcv1_canonical_instant(p_root bytea, p_name text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_value text;
BEGIN
  v_value := hestia.hcv1_text(p_root);
  IF v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION '% is not a canonical UTC instant', p_name;
  END IF;
  BEGIN
    RETURN v_value::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% is not a valid UTC instant', p_name;
  END;
END;
$$;

CREATE FUNCTION hestia.hcv1_authority_operations(p_root bytea)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_operations text[];
  v_sorted text[];
  v_operation text;
BEGIN
  v_operations := hestia.hcv1_vector_texts(p_root);
  IF cardinality(v_operations) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'room authority operation set is outside the bound';
  END IF;
  FOREACH v_operation IN ARRAY v_operations LOOP
    IF length(v_operation) NOT BETWEEN 1 AND 160
       OR btrim(v_operation) <> v_operation
       OR v_operation ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'room authority operation is invalid';
    END IF;
  END LOOP;
  IF cardinality(v_operations) <> (
    SELECT count(DISTINCT value) FROM unnest(v_operations) AS item(value)
  ) THEN
    RAISE EXCEPTION 'room authority operations contain duplicates';
  END IF;
  SELECT array_agg(value ORDER BY value COLLATE "C") INTO v_sorted
    FROM unnest(v_operations) AS item(value);
  IF v_operations IS DISTINCT FROM v_sorted THEN
    RAISE EXCEPTION 'room authority operations are not canonically ordered';
  END IF;
  RETURN v_operations;
END;
$$;

CREATE FUNCTION hestia.hcv1_application_identity(
  p_root bytea,
  OUT app_id text,
  OUT app_version text,
  OUT publisher_id text,
  OUT manifest_digest text,
  OUT lock_digest text,
  OUT approval_digest text
)
RETURNS record
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  PERFORM hestia.hcv1_map_require_keys(
    p_root,
    ARRAY[
      'app_id','approval_digest','lock_digest','manifest_digest',
      'publisher_id','version'
    ]::text[]
  );
  app_id := hestia.hcv1_bounded_text(
    hestia.hcv1_map_get(p_root, 'app_id'),
    'application ID',
    240
  );
  app_version := hestia.hcv1_bounded_text(
    hestia.hcv1_map_get(p_root, 'version'),
    'application version',
    100
  );
  IF app_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION 'application version is not SemVer';
  END IF;
  publisher_id := hestia.hcv1_bounded_text(
    hestia.hcv1_map_get(p_root, 'publisher_id'),
    'application publisher',
    240
  );
  manifest_digest := hestia.hcv1_digest_text(
    hestia.hcv1_map_get(p_root, 'manifest_digest'),
    'application manifest digest'
  );
  lock_digest := hestia.hcv1_optional_digest_text(
    hestia.hcv1_map_get(p_root, 'lock_digest'),
    'application lock digest'
  );
  approval_digest := hestia.hcv1_digest_text(
    hestia.hcv1_map_get(p_root, 'approval_digest'),
    'application approval digest'
  );
END;
$$;

CREATE FUNCTION hestia.hcv1_room_application_limits(
  p_root bytea,
  OUT requests_per_day bigint,
  OUT max_input_bytes bigint,
  OUT max_output_bytes bigint,
  OUT max_timeout_ms bigint
)
RETURNS record
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  PERFORM hestia.hcv1_map_require_keys(
    p_root,
    ARRAY[
      'max_input_bytes','max_output_bytes','max_timeout_ms','requests_per_day'
    ]::text[]
  );
  requests_per_day := hestia.hcv1_bigint(
    hestia.hcv1_map_get(p_root, 'requests_per_day')
  );
  max_input_bytes := hestia.hcv1_bigint(
    hestia.hcv1_map_get(p_root, 'max_input_bytes')
  );
  max_output_bytes := hestia.hcv1_bigint(
    hestia.hcv1_map_get(p_root, 'max_output_bytes')
  );
  max_timeout_ms := hestia.hcv1_bigint(
    hestia.hcv1_map_get(p_root, 'max_timeout_ms')
  );
  IF requests_per_day NOT BETWEEN 1 AND 1000000
     OR max_input_bytes NOT BETWEEN 1 AND 16777216
     OR max_output_bytes NOT BETWEEN 1 AND 16777216
     OR max_timeout_ms NOT BETWEEN 1 AND 86400000 THEN
    RAISE EXCEPTION 'room application limits are outside the admission bounds';
  END IF;
END;
$$;

CREATE FUNCTION hestia.agent_room_authority_prepare(
  p_environment_id text,
  p_signed_record_root bytea
)
RETURNS TABLE (
  prepared_sequence bigint,
  prepared_authority_kind text,
  prepared_room_id text,
  result_authority_root bytea,
  admission_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_room_authority_admission%ROWTYPE;
  v_verification hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_actor hestia.agent_profile%ROWTYPE;
  v_member hestia.agent_room_member%ROWTYPE;
  v_source hestia.agent_room_source_mandate%ROWTYPE;
  v_grant hestia.agent_room_application_grant%ROWTYPE;
  v_body_root bytea;
  v_room_record_root bytea;
  v_governance_root bytea;
  v_actor_profile_record_root bytea;
  v_actor_authority_root bytea;
  v_subject_id text;
  v_authority_kind text;
  v_required_purpose text;
  v_effect_name text;
  v_source_id text;
  v_source_node_id text;
  v_implementation text;
  v_application_root bytea;
  v_app_id text;
  v_app_version text;
  v_publisher_id text;
  v_manifest_digest text;
  v_lock_digest text;
  v_approval_digest text;
  v_operations text[];
  v_membership_epoch bigint;
  v_policy_revision bigint;
  v_requires_user_interaction boolean;
  v_valid_from timestamptz;
  v_valid_until timestamptz;
  v_target_record_root bytea;
  v_member_profile_record_root bytea;
  v_member_node_field bytea;
  v_member_node_id text;
  v_source_mandate_root bytea;
  v_limits_root bytea;
  v_requests_per_day bigint;
  v_max_input_bytes bigint;
  v_max_output_bytes bigint;
  v_max_timeout_ms bigint;
  v_reason text;
  v_revoked_at timestamptz;
  v_authority_sequence bigint;
  v_previous_authority_ref bytea;
  v_authority_root bytea;
  v_effect_plan_root bytea;
  v_outcome_root bytea;
  v_sequence_root bytea;
  v_admission_receipt_root bytea;
  v_admission_sequence bigint;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.agent_room_authority_admission AS admission
   WHERE admission.signed_record_root = p_signed_record_root;
  IF FOUND THEN
    prepared_sequence := v_existing.authority_sequence;
    prepared_authority_kind := replace(v_existing.record_kind, 'room/', '');
    prepared_room_id := v_existing.room_id;
    result_authority_root := v_existing.authority_root;
    admission_receipt_root := v_existing.admission_receipt_root;
    receipt_signing_payload := convert_to(
      'GWAR0:ledger/admission-receipt:'
      || encode(v_existing.admission_receipt_root, 'hex'),
      'UTF8'
    );
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_verification
    FROM hestia.agent_record_verification AS verification
   WHERE verification.signed_record_root = p_signed_record_root
     AND verification.record_kind IN (
       'room/source-mandate',
       'room/source-mandate-revocation',
       'room/application-grant',
       'room/application-grant-revocation'
     )
     AND verification.environment_id = p_environment_id
     AND verification.status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room authority requires a verified Hestia receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer AS signer
   WHERE signer.environment_id = p_environment_id
     AND signer.key_root = v_verification.environment_key_root
     AND signer.status = 'active';

  v_body_root := v_verification.body_root;
  IF v_verification.record_kind = 'room/source-mandate' THEN
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'mandate-id'),
      'source mandate ID',
      240
    );
    v_room_record_root := gw_ledger.cell_ref_child(v_body_root, 1, 'room');
    v_governance_root := gw_ledger.cell_ref_child(v_body_root, 2, 'governance');
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'issued-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 4, 'authority');
    v_source_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 5, 'source-id'),
      'source ID',
      240
    );
    v_source_node_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'source-node'),
      'source node ID',
      240
    );
    v_implementation := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 7, 'implementation'),
      'source implementation',
      240
    );
    v_application_root := gw_ledger.cell_ref_child(v_body_root, 8, 'application');
    SELECT * INTO v_app_id, v_app_version, v_publisher_id,
                  v_manifest_digest, v_lock_digest, v_approval_digest
      FROM hestia.hcv1_application_identity(v_application_root);
    v_operations := hestia.hcv1_authority_operations(
      gw_ledger.cell_ref_child(v_body_root, 9, 'operations')
    );
    v_membership_epoch := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 10, 'membership-epoch')
    );
    v_policy_revision := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 11, 'policy-revision')
    );
    v_requires_user_interaction := hestia.hcv1_boolean(
      gw_ledger.cell_ref_child(v_body_root, 12, 'requires-user-interaction')
    );
    v_valid_from := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 13, 'valid-from'),
      'source mandate valid-from'
    );
    v_valid_until := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 14, 'valid-until'),
      'source mandate valid-until'
    );
    v_authority_kind := 'source-mandate';
    v_required_purpose := 'room.source.manage';
    v_effect_name := 'room-source-mandate-issue';
  ELSIF v_verification.record_kind = 'room/source-mandate-revocation' THEN
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'revocation-id'),
      'source mandate revocation ID',
      240
    );
    v_room_record_root := gw_ledger.cell_ref_child(v_body_root, 1, 'room');
    v_governance_root := gw_ledger.cell_ref_child(v_body_root, 2, 'governance');
    v_target_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'mandate');
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 4, 'revoked-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 5, 'authority');
    v_reason := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'reason'),
      'source revocation reason',
      160
    );
    v_revoked_at := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 7, 'revoked-at'),
      'source mandate revoked-at'
    );
    v_authority_kind := 'source-mandate-revocation';
    v_required_purpose := 'room.source.manage';
    v_effect_name := 'room-source-mandate-revoke';
  ELSIF v_verification.record_kind = 'room/application-grant' THEN
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'grant-id'),
      'room application grant ID',
      240
    );
    v_room_record_root := gw_ledger.cell_ref_child(v_body_root, 1, 'room');
    v_governance_root := gw_ledger.cell_ref_child(v_body_root, 2, 'governance');
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'issued-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 4, 'authority');
    v_member_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 5, 'member-profile');
    v_member_node_field := gw_ledger.cell_ref_child(v_body_root, 6, 'member-node');
    v_member_node_id := hestia.hcv1_optional_bounded_text(
      v_member_node_field,
      'member node ID',
      240
    );
    v_source_mandate_root := gw_ledger.cell_ref_child(v_body_root, 7, 'source-mandate');
    v_application_root := gw_ledger.cell_ref_child(v_body_root, 8, 'application');
    SELECT * INTO v_app_id, v_app_version, v_publisher_id,
                  v_manifest_digest, v_lock_digest, v_approval_digest
      FROM hestia.hcv1_application_identity(v_application_root);
    v_operations := hestia.hcv1_authority_operations(
      gw_ledger.cell_ref_child(v_body_root, 9, 'operations')
    );
    v_limits_root := gw_ledger.cell_ref_child(v_body_root, 10, 'limits');
    SELECT * INTO v_requests_per_day, v_max_input_bytes,
                  v_max_output_bytes, v_max_timeout_ms
      FROM hestia.hcv1_room_application_limits(v_limits_root);
    v_membership_epoch := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 11, 'membership-epoch')
    );
    v_policy_revision := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 12, 'policy-revision')
    );
    v_valid_from := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 13, 'valid-from'),
      'room application grant valid-from'
    );
    v_valid_until := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 14, 'valid-until'),
      'room application grant valid-until'
    );
    v_authority_kind := 'application-grant';
    v_required_purpose := 'room.app.grant';
    v_effect_name := 'room-application-grant-issue';
  ELSE
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'revocation-id'),
      'room application grant revocation ID',
      240
    );
    v_room_record_root := gw_ledger.cell_ref_child(v_body_root, 1, 'room');
    v_governance_root := gw_ledger.cell_ref_child(v_body_root, 2, 'governance');
    v_target_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'grant');
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 4, 'revoked-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 5, 'authority');
    v_reason := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'reason'),
      'room grant revocation reason',
      160
    );
    v_revoked_at := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 7, 'revoked-at'),
      'room application grant revoked-at'
    );
    v_authority_kind := 'application-grant-revocation';
    v_required_purpose := 'room.app.grant';
    v_effect_name := 'room-application-grant-revoke';
  END IF;

  SELECT * INTO v_room
    FROM hestia.agent_room AS room
   WHERE room.current_record_root = v_room_record_root
     AND room.status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room authority targets an unknown or closed room';
  END IF;
  IF v_governance_root <> v_room.current_state_root THEN
    RAISE EXCEPTION 'room authority does not bind the current governance root';
  END IF;

  SELECT * INTO v_actor
    FROM hestia.agent_profile AS profile
   WHERE profile.current_record_root = v_actor_profile_record_root
     AND profile.status = 'active'
   FOR UPDATE;
  IF NOT FOUND OR v_actor.profile_id <> v_room.host_profile_id THEN
    RAISE EXCEPTION 'room authority actor is not the current room host';
  END IF;
  IF v_actor_authority_root <> v_actor.delegation_root
     OR v_verification.signer_key_root <> v_actor.operational_key_root
     OR NOT hestia.agent_profile_authorized(
       v_actor.profile_id,
       v_actor.current_record_root,
       v_verification.signer_key_root,
       v_required_purpose
     ) THEN
    RAISE EXCEPTION 'room authority is not signed by an authorized host key';
  END IF;

  IF v_verification.record_kind IN (
       'room/source-mandate',
       'room/application-grant'
     ) THEN
    IF v_membership_epoch <> v_room.membership_epoch
       OR v_policy_revision <> v_room.authority_policy_revision THEN
      RAISE EXCEPTION 'room authority epoch or policy revision is stale';
    END IF;
    IF v_valid_until <= v_valid_from THEN
      RAISE EXCEPTION 'room authority validity interval is empty';
    END IF;
  END IF;

  IF v_verification.record_kind = 'room/source-mandate' THEN
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_source_mandate AS mandate
       WHERE mandate.room_id = v_room.room_id
         AND mandate.mandate_id = v_subject_id
    ) THEN
      RAISE EXCEPTION 'source mandate identifier already belongs to another record';
    END IF;
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_source_mandate AS mandate
       WHERE mandate.room_id = v_room.room_id
         AND mandate.source_id = v_source_id
         AND mandate.status = 'active'
    ) THEN
      RAISE EXCEPTION 'room source already has an active mandate';
    END IF;
  ELSIF v_verification.record_kind = 'room/source-mandate-revocation' THEN
    SELECT * INTO v_source
      FROM hestia.agent_room_source_mandate AS mandate
     WHERE mandate.signed_record_root = v_target_record_root
       AND mandate.room_id = v_room.room_id
       AND mandate.status = 'active'
     FOR UPDATE;
    IF NOT FOUND OR v_revoked_at < v_source.valid_from THEN
      RAISE EXCEPTION 'source revocation does not target an active room mandate';
    END IF;
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_source_mandate_revocation AS revocation
       WHERE revocation.room_id = v_room.room_id
         AND revocation.revocation_id = v_subject_id
    ) THEN
      RAISE EXCEPTION 'source revocation identifier already belongs to another record';
    END IF;
  ELSIF v_verification.record_kind = 'room/application-grant' THEN
    SELECT * INTO v_member
      FROM hestia.agent_room_member AS member
     WHERE member.room_id = v_room.room_id
       AND member.member_profile_record_root = v_member_profile_record_root
       AND member.status = 'active'
     FOR UPDATE;
    IF NOT FOUND OR NOT ('room.app.invoke' = ANY(v_member.purposes)) THEN
      RAISE EXCEPTION 'room application grant member is not active or invocable';
    END IF;
    SELECT * INTO v_source
      FROM hestia.agent_room_source_mandate AS mandate
     WHERE mandate.signed_record_root = v_source_mandate_root
       AND mandate.room_id = v_room.room_id
       AND mandate.status = 'active'
     FOR UPDATE;
    IF NOT FOUND
       OR statement_timestamp() NOT BETWEEN v_source.valid_from AND v_source.valid_until
       OR v_source.governance_root <> v_room.current_state_root
       OR v_source.membership_epoch <> v_room.membership_epoch
       OR v_source.policy_revision <> v_room.authority_policy_revision THEN
      RAISE EXCEPTION 'room application grant source mandate is not active';
    END IF;
    IF v_app_id <> v_source.app_id
       OR v_app_version <> v_source.app_version
       OR v_publisher_id <> v_source.publisher_id
       OR v_manifest_digest <> v_source.manifest_digest
       OR v_lock_digest IS DISTINCT FROM v_source.lock_digest
       OR v_approval_digest <> v_source.approval_digest THEN
      RAISE EXCEPTION 'room application grant changes the source application';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_operations) AS requested(operation)
       WHERE NOT (requested.operation = ANY(v_source.operations))
    ) THEN
      RAISE EXCEPTION 'room application grant broadens source operations';
    END IF;
    IF v_valid_from < v_source.valid_from OR v_valid_until > v_source.valid_until THEN
      RAISE EXCEPTION 'room application grant exceeds source validity';
    END IF;
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_application_grant AS grant_row
       WHERE grant_row.room_id = v_room.room_id
         AND grant_row.grant_id = v_subject_id
    ) THEN
      RAISE EXCEPTION 'room application grant identifier already belongs to another record';
    END IF;
  ELSE
    SELECT * INTO v_grant
      FROM hestia.agent_room_application_grant AS grant_row
     WHERE grant_row.signed_record_root = v_target_record_root
       AND grant_row.room_id = v_room.room_id
       AND grant_row.status = 'active'
     FOR UPDATE;
    IF NOT FOUND OR v_revoked_at < v_grant.valid_from THEN
      RAISE EXCEPTION 'grant revocation does not target an active room grant';
    END IF;
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_application_grant_revocation AS revocation
       WHERE revocation.room_id = v_room.room_id
         AND revocation.revocation_id = v_subject_id
    ) THEN
      RAISE EXCEPTION 'grant revocation identifier already belongs to another record';
    END IF;
  END IF;

  v_authority_sequence := v_room.authority_sequence + 1;
  IF v_authority_sequence <= v_room.authority_sequence THEN
    RAISE EXCEPTION 'room authority sequence overflow';
  END IF;
  v_previous_authority_ref := COALESCE(
    v_room.authority_head_root,
    hestia.hcv1_nil_put()
  );
  v_sequence_root := hestia.hcv1_integer_put(v_authority_sequence);
  v_authority_root := hestia.agent_record_put(
    'room/authority-state',
    ARRAY[
      v_room.current_state_root,
      v_previous_authority_ref,
      p_signed_record_root,
      hestia.hcv1_string_put(v_authority_kind),
      hestia.hcv1_integer_put(v_room.membership_epoch),
      hestia.hcv1_integer_put(v_room.authority_policy_revision),
      v_sequence_root
    ]::bytea[]
  );
  v_effect_plan_root := hestia.hcv1_string_put(v_effect_name);
  v_outcome_root := hestia.hcv1_string_put('accepted');
  v_admission_receipt_root := hestia.agent_record_put(
    'ledger/admission-receipt',
    ARRAY[
      v_previous_authority_ref,
      v_body_root,
      v_room.policy_root,
      v_room.kernel_root,
      v_authority_root,
      v_effect_plan_root,
      p_signed_record_root,
      v_outcome_root,
      v_sequence_root
    ]::bytea[]
  );
  v_admission_sequence := nextval('hestia.agent_room_transition_sequence'::regclass);

  INSERT INTO hestia.agent_room_authority_admission (
    admission_sequence,
    signed_record_root,
    record_kind,
    body_root,
    verification_signed_receipt_root,
    room_id,
    expected_room_record_root,
    expected_room_state_root,
    expected_membership_epoch,
    expected_policy_revision,
    expected_authority_sequence,
    expected_authority_head_root,
    actor_profile_id,
    expected_actor_profile_record_root,
    expected_actor_profile_state_root,
    actor_operational_key_root,
    actor_delegation_root,
    required_purpose,
    subject_id,
    authority_sequence,
    authority_root,
    effect_plan_root,
    outcome_root,
    admission_receipt_root,
    environment_id,
    environment_key_root,
    status
  ) VALUES (
    v_admission_sequence,
    p_signed_record_root,
    v_verification.record_kind,
    v_body_root,
    v_verification.signed_receipt_root,
    v_room.room_id,
    v_room.current_record_root,
    v_room.current_state_root,
    v_room.membership_epoch,
    v_room.authority_policy_revision,
    v_room.authority_sequence,
    v_room.authority_head_root,
    v_actor.profile_id,
    v_actor.current_record_root,
    v_actor.current_state_root,
    v_actor.operational_key_root,
    v_actor.delegation_root,
    v_required_purpose,
    v_subject_id,
    v_authority_sequence,
    v_authority_root,
    v_effect_plan_root,
    v_outcome_root,
    v_admission_receipt_root,
    p_environment_id,
    v_environment.key_root,
    'pending-signature'
  );

  prepared_sequence := v_authority_sequence;
  prepared_authority_kind := v_authority_kind;
  prepared_room_id := v_room.room_id;
  result_authority_root := v_authority_root;
  admission_receipt_root := v_admission_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:' || encode(v_admission_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_authority_commit(
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
  v_row hestia.agent_room_authority_admission%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_actor hestia.agent_profile%ROWTYPE;
  v_member hestia.agent_room_member%ROWTYPE;
  v_source hestia.agent_room_source_mandate%ROWTYPE;
  v_grant hestia.agent_room_application_grant%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_signing_payload bytea;
  v_body_root bytea;
  v_governance_root bytea;
  v_actor_profile_record_root bytea;
  v_actor_authority_root bytea;
  v_subject_id text;
  v_source_id text;
  v_source_node_id text;
  v_implementation text;
  v_application_root bytea;
  v_app_id text;
  v_app_version text;
  v_publisher_id text;
  v_manifest_digest text;
  v_lock_digest text;
  v_approval_digest text;
  v_operations text[];
  v_membership_epoch bigint;
  v_policy_revision bigint;
  v_requires_user_interaction boolean;
  v_valid_from timestamptz;
  v_valid_until timestamptz;
  v_target_record_root bytea;
  v_member_profile_record_root bytea;
  v_member_node_id text;
  v_source_mandate_root bytea;
  v_limits_root bytea;
  v_requests_per_day bigint;
  v_max_input_bytes bigint;
  v_max_output_bytes bigint;
  v_max_timeout_ms bigint;
  v_reason text;
  v_revoked_at timestamptz;
  v_authority_kind text;
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_room_authority_admission AS admission
   WHERE admission.signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room authority record has not been prepared';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'room authority was prepared for another environment';
  END IF;
  IF v_row.status = 'accepted' THEN
    RETURN v_row.admission_signed_receipt_root;
  END IF;

  SELECT * INTO v_environment
    FROM hestia.environment_signer AS signer
   WHERE signer.environment_id = p_environment_id
     AND signer.key_root = v_row.environment_key_root
     AND signer.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepared Hestia environment signer is no longer active';
  END IF;
  IF p_environment_signature IS NULL
     OR octet_length(p_environment_signature) <> 64 THEN
    RAISE EXCEPTION 'room authority receipt requires a 64-byte Ed25519 signature';
  END IF;
  v_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:'
    || encode(v_row.admission_receipt_root, 'hex'),
    'UTF8'
  );
  IF NOT gw_ledger.signature_verify(
    p_environment_signature,
    v_signing_payload,
    v_environment.public_key
  ) THEN
    RAISE EXCEPTION 'invalid room authority admission signature';
  END IF;

  SELECT * INTO v_room
    FROM hestia.agent_room AS room
   WHERE room.room_id = v_row.room_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_room.status <> 'open'
     OR v_room.current_record_root <> v_row.expected_room_record_root
     OR v_room.current_state_root <> v_row.expected_room_state_root
     OR v_room.membership_epoch <> v_row.expected_membership_epoch
     OR v_room.authority_policy_revision <> v_row.expected_policy_revision
     OR v_room.authority_sequence <> v_row.expected_authority_sequence
     OR v_room.authority_head_root IS DISTINCT FROM v_row.expected_authority_head_root THEN
    RAISE EXCEPTION 'room authority head changed after preparation';
  END IF;

  SELECT * INTO v_actor
    FROM hestia.agent_profile AS profile
   WHERE profile.profile_id = v_row.actor_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_actor.status <> 'active'
     OR v_actor.current_record_root <> v_row.expected_actor_profile_record_root
     OR v_actor.current_state_root <> v_row.expected_actor_profile_state_root
     OR v_actor.operational_key_root <> v_row.actor_operational_key_root
     OR v_actor.delegation_root <> v_row.actor_delegation_root
     OR v_actor.profile_id <> v_room.host_profile_id
     OR NOT hestia.agent_profile_authorized(
       v_actor.profile_id,
       v_actor.current_record_root,
       v_actor.operational_key_root,
       v_row.required_purpose
     ) THEN
    RAISE EXCEPTION 'room authority actor changed after preparation';
  END IF;

  v_body_root := v_row.body_root;
  v_governance_root := gw_ledger.cell_ref_child(v_body_root, 2, 'governance');
  IF v_governance_root <> v_room.current_state_root THEN
    RAISE EXCEPTION 'room authority governance changed after preparation';
  END IF;

  v_signature_root := hestia.hcv1_blob_put(p_environment_signature);
  v_signed_receipt_root := hestia.environment_admission_signed_record_put(
    v_row.admission_receipt_root,
    v_environment.key_root,
    v_signature_root
  );
  v_authority_kind := replace(v_row.record_kind, 'room/', '');

  INSERT INTO hestia.agent_room_authority (
    room_id,
    sequence,
    authority_root,
    previous_authority_root,
    room_state_root,
    event_record_root,
    event_body_root,
    authority_kind,
    actor_profile_id,
    actor_profile_record_root,
    membership_epoch,
    policy_revision,
    effect_plan_root,
    admission_signed_receipt_root
  ) VALUES (
    v_room.room_id,
    v_row.authority_sequence,
    v_row.authority_root,
    v_row.expected_authority_head_root,
    v_room.current_state_root,
    p_signed_record_root,
    v_body_root,
    v_authority_kind,
    v_actor.profile_id,
    v_actor.current_record_root,
    v_room.membership_epoch,
    v_room.authority_policy_revision,
    v_row.effect_plan_root,
    v_signed_receipt_root
  );

  IF v_row.record_kind = 'room/source-mandate' THEN
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'mandate-id'),
      'source mandate ID',
      240
    );
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'issued-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 4, 'authority');
    v_source_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 5, 'source-id'),
      'source ID',
      240
    );
    v_source_node_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'source-node'),
      'source node ID',
      240
    );
    v_implementation := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 7, 'implementation'),
      'source implementation',
      240
    );
    v_application_root := gw_ledger.cell_ref_child(v_body_root, 8, 'application');
    SELECT * INTO v_app_id, v_app_version, v_publisher_id,
                  v_manifest_digest, v_lock_digest, v_approval_digest
      FROM hestia.hcv1_application_identity(v_application_root);
    v_operations := hestia.hcv1_authority_operations(
      gw_ledger.cell_ref_child(v_body_root, 9, 'operations')
    );
    v_membership_epoch := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 10, 'membership-epoch')
    );
    v_policy_revision := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 11, 'policy-revision')
    );
    v_requires_user_interaction := hestia.hcv1_boolean(
      gw_ledger.cell_ref_child(v_body_root, 12, 'requires-user-interaction')
    );
    v_valid_from := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 13, 'valid-from'),
      'source mandate valid-from'
    );
    v_valid_until := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 14, 'valid-until'),
      'source mandate valid-until'
    );
    INSERT INTO hestia.agent_room_source_mandate (
      room_id, mandate_id, signed_record_root, body_root, governance_root,
      authority_sequence, authority_root, issued_by_profile_id,
      issued_by_profile_record_root, issuer_authority_root, source_id,
      source_node_id, implementation, application_root, app_id, app_version,
      publisher_id, manifest_digest, lock_digest, approval_digest, operations,
      membership_epoch, policy_revision, requires_user_interaction,
      valid_from, valid_until, status, admission_signed_receipt_root
    ) VALUES (
      v_room.room_id, v_subject_id, p_signed_record_root, v_body_root,
      v_room.current_state_root, v_row.authority_sequence, v_row.authority_root,
      v_actor.profile_id, v_actor_profile_record_root, v_actor_authority_root,
      v_source_id, v_source_node_id, v_implementation, v_application_root,
      v_app_id, v_app_version, v_publisher_id, v_manifest_digest, v_lock_digest,
      v_approval_digest, v_operations, v_membership_epoch, v_policy_revision,
      v_requires_user_interaction, v_valid_from, v_valid_until, 'active',
      v_signed_receipt_root
    );
  ELSIF v_row.record_kind = 'room/source-mandate-revocation' THEN
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'revocation-id'),
      'source mandate revocation ID',
      240
    );
    v_target_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'mandate');
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 4, 'revoked-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 5, 'authority');
    v_reason := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'reason'),
      'source revocation reason',
      160
    );
    v_revoked_at := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 7, 'revoked-at'),
      'source mandate revoked-at'
    );
    SELECT * INTO v_source
      FROM hestia.agent_room_source_mandate AS mandate
     WHERE mandate.signed_record_root = v_target_record_root
       AND mandate.room_id = v_room.room_id
       AND mandate.status = 'active'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source mandate changed after revocation preparation';
    END IF;
    INSERT INTO hestia.agent_room_source_mandate_revocation (
      room_id, revocation_id, signed_record_root, body_root, governance_root,
      mandate_record_root, authority_sequence, authority_root,
      revoked_by_profile_id, revoked_by_profile_record_root,
      revoker_authority_root, reason, revoked_at, admission_signed_receipt_root
    ) VALUES (
      v_room.room_id, v_subject_id, p_signed_record_root, v_body_root,
      v_room.current_state_root, v_target_record_root, v_row.authority_sequence,
      v_row.authority_root, v_actor.profile_id, v_actor_profile_record_root,
      v_actor_authority_root, v_reason, v_revoked_at, v_signed_receipt_root
    );
    UPDATE hestia.agent_room_source_mandate
       SET status = 'revoked',
           revocation_record_root = p_signed_record_root,
           revoked_at = v_revoked_at,
           updated_at = clock_timestamp()
     WHERE signed_record_root = v_target_record_root;
  ELSIF v_row.record_kind = 'room/application-grant' THEN
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'grant-id'),
      'room application grant ID',
      240
    );
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'issued-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 4, 'authority');
    v_member_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 5, 'member-profile');
    v_member_node_id := hestia.hcv1_optional_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'member-node'),
      'member node ID',
      240
    );
    v_source_mandate_root := gw_ledger.cell_ref_child(v_body_root, 7, 'source-mandate');
    v_application_root := gw_ledger.cell_ref_child(v_body_root, 8, 'application');
    SELECT * INTO v_app_id, v_app_version, v_publisher_id,
                  v_manifest_digest, v_lock_digest, v_approval_digest
      FROM hestia.hcv1_application_identity(v_application_root);
    v_operations := hestia.hcv1_authority_operations(
      gw_ledger.cell_ref_child(v_body_root, 9, 'operations')
    );
    v_limits_root := gw_ledger.cell_ref_child(v_body_root, 10, 'limits');
    SELECT * INTO v_requests_per_day, v_max_input_bytes,
                  v_max_output_bytes, v_max_timeout_ms
      FROM hestia.hcv1_room_application_limits(v_limits_root);
    v_membership_epoch := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 11, 'membership-epoch')
    );
    v_policy_revision := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 12, 'policy-revision')
    );
    v_valid_from := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 13, 'valid-from'),
      'room application grant valid-from'
    );
    v_valid_until := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 14, 'valid-until'),
      'room application grant valid-until'
    );
    SELECT * INTO STRICT v_member
      FROM hestia.agent_room_member AS member
     WHERE member.room_id = v_room.room_id
       AND member.member_profile_record_root = v_member_profile_record_root
       AND member.status = 'active';
    SELECT * INTO STRICT v_source
      FROM hestia.agent_room_source_mandate AS mandate
     WHERE mandate.signed_record_root = v_source_mandate_root
       AND mandate.room_id = v_room.room_id
       AND mandate.status = 'active';
    INSERT INTO hestia.agent_room_application_grant (
      room_id, grant_id, signed_record_root, body_root, governance_root,
      authority_sequence, authority_root, issued_by_profile_id,
      issued_by_profile_record_root, issuer_authority_root, member_profile_id,
      member_profile_record_root, member_node_id, source_mandate_record_root,
      application_root, app_id, app_version, publisher_id, manifest_digest,
      lock_digest, approval_digest, operations, requests_per_day,
      max_input_bytes, max_output_bytes, max_timeout_ms, membership_epoch,
      policy_revision, valid_from, valid_until, status,
      admission_signed_receipt_root
    ) VALUES (
      v_room.room_id, v_subject_id, p_signed_record_root, v_body_root,
      v_room.current_state_root, v_row.authority_sequence, v_row.authority_root,
      v_actor.profile_id, v_actor_profile_record_root, v_actor_authority_root,
      v_member.member_profile_id, v_member_profile_record_root, v_member_node_id,
      v_source_mandate_root, v_application_root, v_app_id, v_app_version,
      v_publisher_id, v_manifest_digest, v_lock_digest, v_approval_digest,
      v_operations, v_requests_per_day, v_max_input_bytes, v_max_output_bytes,
      v_max_timeout_ms, v_membership_epoch, v_policy_revision, v_valid_from,
      v_valid_until, 'active', v_signed_receipt_root
    );
  ELSE
    v_subject_id := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 0, 'revocation-id'),
      'room application grant revocation ID',
      240
    );
    v_target_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'grant');
    v_actor_profile_record_root := gw_ledger.cell_ref_child(v_body_root, 4, 'revoked-by');
    v_actor_authority_root := gw_ledger.cell_ref_child(v_body_root, 5, 'authority');
    v_reason := hestia.hcv1_bounded_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'reason'),
      'room grant revocation reason',
      160
    );
    v_revoked_at := hestia.hcv1_canonical_instant(
      gw_ledger.cell_ref_child(v_body_root, 7, 'revoked-at'),
      'room application grant revoked-at'
    );
    SELECT * INTO v_grant
      FROM hestia.agent_room_application_grant AS grant_row
     WHERE grant_row.signed_record_root = v_target_record_root
       AND grant_row.room_id = v_room.room_id
       AND grant_row.status = 'active'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'room application grant changed after revocation preparation';
    END IF;
    INSERT INTO hestia.agent_room_application_grant_revocation (
      room_id, revocation_id, signed_record_root, body_root, governance_root,
      grant_record_root, authority_sequence, authority_root,
      revoked_by_profile_id, revoked_by_profile_record_root,
      revoker_authority_root, reason, revoked_at, admission_signed_receipt_root
    ) VALUES (
      v_room.room_id, v_subject_id, p_signed_record_root, v_body_root,
      v_room.current_state_root, v_target_record_root, v_row.authority_sequence,
      v_row.authority_root, v_actor.profile_id, v_actor_profile_record_root,
      v_actor_authority_root, v_reason, v_revoked_at, v_signed_receipt_root
    );
    UPDATE hestia.agent_room_application_grant
       SET status = 'revoked',
           revocation_record_root = p_signed_record_root,
           revoked_at = v_revoked_at,
           updated_at = clock_timestamp()
     WHERE signed_record_root = v_target_record_root;
  END IF;

  UPDATE hestia.agent_room
     SET authority_sequence = v_row.authority_sequence,
         authority_head_root = v_row.authority_root,
         updated_at = clock_timestamp()
   WHERE room_id = v_room.room_id;

  UPDATE hestia.agent_room_authority_admission
     SET environment_signature_root = v_signature_root,
         admission_signed_receipt_root = v_signed_receipt_root,
         status = 'accepted',
         accepted_at = clock_timestamp()
   WHERE admission_sequence = v_row.admission_sequence;

  RETURN v_signed_receipt_root;
END;
$$;

REVOKE ALL ON hestia.agent_room_authority FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_source_mandate FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_source_mandate_revocation FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_application_grant FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_application_grant_revocation FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_authority_admission FROM PUBLIC;

GRANT SELECT ON hestia.agent_room_authority TO hestia_app;
GRANT SELECT ON hestia.agent_room_source_mandate TO hestia_app;
GRANT SELECT ON hestia.agent_room_source_mandate_revocation TO hestia_app;
GRANT SELECT ON hestia.agent_room_application_grant TO hestia_app;
GRANT SELECT ON hestia.agent_room_application_grant_revocation TO hestia_app;
GRANT SELECT ON hestia.agent_room_authority_admission TO hestia_app;

GRANT EXECUTE ON FUNCTION hestia.agent_room_authority_prepare(text, bytea)
  TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_authority_commit(text, bytea, bytea)
  TO hestia_app;
