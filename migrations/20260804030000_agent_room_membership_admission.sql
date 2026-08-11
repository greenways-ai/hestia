CREATE SEQUENCE hestia.agent_room_transition_sequence AS bigint;

CREATE TABLE hestia.environment_room_policy (
  environment_id text PRIMARY KEY,
  room_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  room_kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  allowed_invite_purposes text[] NOT NULL
    CHECK (cardinality(allowed_invite_purposes) BETWEEN 1 AND 32),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK ((status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE TABLE hestia.agent_room_version (
  room_id text NOT NULL CHECK (length(room_id) BETWEEN 1 AND 256),
  sequence bigint NOT NULL CHECK (sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  previous_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  host_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  host_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  acceptance_mode text NOT NULL,
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, sequence)
);

CREATE TABLE hestia.agent_room (
  room_id text PRIMARY KEY CHECK (length(room_id) BETWEEN 1 AND 256),
  current_sequence bigint NOT NULL CHECK (current_sequence > 0),
  current_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  current_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  current_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  host_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  host_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  acceptance_mode text NOT NULL,
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  members_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  invitations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  last_transition_sequence bigint NOT NULL CHECK (last_transition_sequence > 0),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE hestia.agent_room_state_version (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  transition_sequence bigint NOT NULL CHECK (transition_sequence > 0),
  state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  previous_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  event_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  members_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  invitations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  effect_plan_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, transition_sequence)
);

CREATE TABLE hestia.agent_room_member (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  member_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  member_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  current_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  role text NOT NULL CHECK (length(role) BETWEEN 1 AND 64),
  purposes text[] NOT NULL CHECK (cardinality(purposes) BETWEEN 1 AND 32),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  joined_epoch bigint NOT NULL CHECK (joined_epoch > 0),
  revoked_epoch bigint,
  delegation_root bytea NOT NULL REFERENCES hestia.agent_key_delegation(signed_record_root),
  admitted_by_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, member_profile_id),
  CHECK ((status = 'active' AND revoked_epoch IS NULL)
      OR (status = 'revoked' AND revoked_epoch IS NOT NULL
          AND revoked_epoch > joined_epoch))
);

CREATE TABLE hestia.agent_room_member_version (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  member_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  transition_sequence bigint NOT NULL CHECK (transition_sequence > 0),
  state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  previous_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  member_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  role text NOT NULL,
  purposes text[] NOT NULL,
  status text NOT NULL,
  joined_epoch bigint NOT NULL,
  revoked_epoch bigint,
  delegation_root bytea NOT NULL REFERENCES hestia.agent_key_delegation(signed_record_root),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, member_profile_id, transition_sequence)
);

CREATE TABLE hestia.agent_room_invitation (
  invite_id text PRIMARY KEY CHECK (length(invite_id) BETWEEN 1 AND 256),
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  host_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  host_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  role text NOT NULL CHECK (length(role) BETWEEN 1 AND 64),
  purposes text[] NOT NULL CHECK (cardinality(purposes) BETWEEN 1 AND 32),
  expires_at timestamptz NOT NULL,
  capability_commitment_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  one_time boolean NOT NULL,
  current_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  consumed_by_profile_id text REFERENCES hestia.agent_profile(profile_id),
  consumed_by_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  issued_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  consumed_signed_receipt_root bytea REFERENCES gw_ledger."Cell"(hash),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'active'
          AND consumed_by_profile_id IS NULL
          AND consumed_by_record_root IS NULL
          AND consumed_signed_receipt_root IS NULL)
      OR (status = 'consumed'
          AND consumed_by_profile_id IS NOT NULL
          AND consumed_by_record_root IS NOT NULL
          AND consumed_signed_receipt_root IS NOT NULL)
      OR status IN ('revoked', 'expired'))
);

CREATE TABLE hestia.agent_room_invitation_version (
  invite_id text NOT NULL,
  transition_sequence bigint NOT NULL CHECK (transition_sequence > 0),
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  previous_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  signed_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL,
  consumed_by_profile_id text,
  consumed_by_record_root bytea REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (invite_id, transition_sequence)
);

CREATE TABLE hestia.agent_room_genesis_admission (
  transition_sequence bigint PRIMARY KEY CHECK (transition_sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  room_id text NOT NULL,
  room_sequence bigint NOT NULL CHECK (room_sequence = 1),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  host_profile_id text NOT NULL,
  expected_host_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_host_profile_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  host_operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  host_delegation_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  owner_member_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  members_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  invitations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  acceptance_mode text NOT NULL,
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
  CHECK ((status = 'pending-signature'
          AND environment_signature_root IS NULL
          AND admission_signed_receipt_root IS NULL
          AND accepted_at IS NULL)
      OR (status = 'accepted'
          AND environment_signature_root IS NOT NULL
          AND admission_signed_receipt_root IS NOT NULL
          AND accepted_at IS NOT NULL))
);

CREATE TABLE hestia.agent_room_invitation_admission (
  transition_sequence bigint PRIMARY KEY CHECK (transition_sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  invite_id text NOT NULL,
  room_id text NOT NULL,
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_room_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_host_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_host_profile_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  invitation_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_invitations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_room_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  host_profile_id text NOT NULL,
  role text NOT NULL,
  purposes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  capability_commitment_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  one_time boolean NOT NULL,
  policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
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
  CHECK ((status = 'pending-signature'
          AND environment_signature_root IS NULL
          AND admission_signed_receipt_root IS NULL
          AND accepted_at IS NULL)
      OR (status = 'accepted'
          AND environment_signature_root IS NOT NULL
          AND admission_signed_receipt_root IS NOT NULL
          AND accepted_at IS NOT NULL))
);

CREATE TABLE hestia.agent_room_member_admission (
  transition_sequence bigint PRIMARY KEY CHECK (transition_sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  proof_id text NOT NULL,
  invite_id text NOT NULL,
  invite_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  room_id text NOT NULL,
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_room_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_membership_epoch bigint NOT NULL CHECK (expected_membership_epoch > 0),
  expected_invitation_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_guest_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_guest_profile_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  guest_profile_id text NOT NULL,
  guest_operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  guest_delegation_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  role text NOT NULL,
  purposes text[] NOT NULL,
  next_membership_epoch bigint NOT NULL CHECK (next_membership_epoch > 1),
  guest_member_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  consumed_invitation_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_members_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_invitations_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  result_room_state_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  kernel_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
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

CREATE FUNCTION hestia.hcv1_boolean(p_root bytea)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_payload bytea;
BEGIN
  IF gw_ledger.cell_type_tag(p_root) <> 1 THEN
    RAISE EXCEPTION 'HCV0 value is not a boolean';
  END IF;
  SELECT payload INTO STRICT v_payload
    FROM gw_ledger."Cell" WHERE hash = p_root;
  IF v_payload = decode('00', 'hex') THEN
    RETURN false;
  ELSIF v_payload = decode('01', 'hex') THEN
    RETURN true;
  END IF;
  RAISE EXCEPTION 'invalid HCV0 boolean transport';
END;
$$;

CREATE FUNCTION hestia.hcv1_vector_put(p_roots bytea[])
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := cardinality(p_roots);
  v_payload_text text;
  v_root bytea;
  v_index integer;
BEGIN
  IF p_roots IS NULL THEN
    RAISE EXCEPTION 'HCV0 vector roots are required';
  END IF;
  v_payload_text := 'S:' || v_count::text || ':';
  IF v_count > 0 THEN
    FOR v_index IN 1..v_count LOOP
      IF p_roots[v_index] IS NULL OR octet_length(p_roots[v_index]) <> 32 THEN
        RAISE EXCEPTION 'invalid HCV0 vector child at position %', v_index - 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_roots[v_index]) THEN
        RAISE EXCEPTION 'missing HCV0 vector child at position %', v_index - 1;
      END IF;
      v_payload_text := v_payload_text || encode(p_roots[v_index], 'hex');
    END LOOP;
  END IF;
  v_root := hestia.hcv1_put(10, convert_to(v_payload_text, 'UTF8'));
  IF v_count > 0 THEN
    FOR v_index IN 1..v_count LOOP
      PERFORM gw_ledger.cell_ref_put(v_root, v_index - 1, 'element', p_roots[v_index]);
    END LOOP;
  END IF;
  RETURN v_root;
END;
$$;

CREATE FUNCTION hestia.hcv1_vector_strings_put(p_values text[])
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_roots bytea[] := ARRAY[]::bytea[];
  v_count integer := cardinality(p_values);
  v_index integer;
BEGIN
  IF p_values IS NULL THEN
    RAISE EXCEPTION 'HCV0 vector values are required';
  END IF;
  IF v_count > 0 THEN
    FOR v_index IN 1..v_count LOOP
      v_roots := array_append(v_roots, hestia.hcv1_string_put(p_values[v_index]));
    END LOOP;
  END IF;
  RETURN hestia.hcv1_vector_put(v_roots);
END;
$$;

CREATE FUNCTION hestia.agent_profile_authorized(
  p_profile_id text,
  p_profile_record_root bytea,
  p_signer_key_root bytea,
  p_purpose text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hestia.agent_profile AS profile
      JOIN hestia.agent_key_delegation AS delegation
        ON delegation.signed_record_root = profile.delegation_root
     WHERE profile.profile_id = p_profile_id
       AND profile.current_record_root = p_profile_record_root
       AND profile.operational_key_root = p_signer_key_root
       AND profile.status = 'active'
       AND delegation.issuer_profile_id = profile.profile_id
       AND delegation.subject_key_root = profile.operational_key_root
       AND delegation.revocation_root IS NULL
       AND statement_timestamp() BETWEEN delegation.valid_from AND delegation.valid_until
       AND p_purpose = ANY(delegation.purposes)
  )
$$;

CREATE FUNCTION hestia.agent_room_members_vector(
  p_room_id text,
  p_member_profile_id text,
  p_member_state_root bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_roots bytea[];
BEGIN
  v_roots := ARRAY(
    SELECT candidate.state_root
      FROM (
        SELECT member_profile_id, current_state_root AS state_root
          FROM hestia.agent_room_member
         WHERE room_id = p_room_id
           AND member_profile_id <> p_member_profile_id
        UNION ALL
        SELECT p_member_profile_id, p_member_state_root
      ) AS candidate
     ORDER BY candidate.member_profile_id
  );
  RETURN hestia.hcv1_vector_put(v_roots);
END;
$$;

CREATE FUNCTION hestia.agent_room_invitations_vector(
  p_room_id text,
  p_invite_id text,
  p_invitation_state_root bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_roots bytea[];
BEGIN
  v_roots := ARRAY(
    SELECT candidate.state_root
      FROM (
        SELECT invite_id, current_state_root AS state_root
          FROM hestia.agent_room_invitation
         WHERE room_id = p_room_id
           AND invite_id <> p_invite_id
        UNION ALL
        SELECT p_invite_id, p_invitation_state_root
      ) AS candidate
     ORDER BY candidate.invite_id
  );
  RETURN hestia.hcv1_vector_put(v_roots);
END;
$$;

CREATE FUNCTION hestia.agent_room_state_put(
  p_room_id_root bytea,
  p_room_record_root bytea,
  p_host_profile_root bytea,
  p_membership_epoch bigint,
  p_members_root bytea,
  p_invitations_root bytea,
  p_policy_root bytea,
  p_kernel_root bytea,
  p_acceptance_mode_root bytea,
  p_status text
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN hestia.agent_record_put(
    'room/state',
    ARRAY[
      p_room_id_root,
      p_room_record_root,
      p_host_profile_root,
      hestia.hcv1_integer_put(p_membership_epoch),
      p_members_root,
      p_invitations_root,
      p_policy_root,
      p_kernel_root,
      p_acceptance_mode_root,
      hestia.hcv1_string_put(p_status)
    ]::bytea[]
  );
END;
$$;

CREATE FUNCTION hestia.room_capability_commitment_root(
  p_invite_id text,
  p_capability bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_digest bytea;
BEGIN
  IF p_invite_id IS NULL OR length(p_invite_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'invalid room invitation identifier';
  END IF;
  IF p_capability IS NULL OR octet_length(p_capability) <> 32 THEN
    RAISE EXCEPTION 'room invitation capability must be 32 bytes';
  END IF;
  v_digest := gw_ledger.sha256(
    convert_to('HESTIA-ROOM-CAPABILITY/1', 'UTF8')
    || decode('00', 'hex')
    || convert_to(p_invite_id, 'UTF8')
    || decode('00', 'hex')
    || p_capability
  );
  RETURN hestia.hcv1_blob_put(v_digest);
END;
$$;

CREATE FUNCTION hestia.room_admission_proof_root(
  p_capability bytea,
  p_invite_record_root bytea,
  p_guest_profile_record_root bytea
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_digest bytea;
BEGIN
  IF p_capability IS NULL OR octet_length(p_capability) <> 32 THEN
    RAISE EXCEPTION 'room admission capability must be 32 bytes';
  END IF;
  IF p_invite_record_root IS NULL OR octet_length(p_invite_record_root) <> 32
     OR p_guest_profile_record_root IS NULL
     OR octet_length(p_guest_profile_record_root) <> 32 THEN
    RAISE EXCEPTION 'room admission proof requires invitation and profile roots';
  END IF;
  v_digest := gw_ledger.sha256(
    convert_to('HESTIA-ROOM-ADMISSION/1', 'UTF8')
    || decode('00', 'hex')
    || p_capability
    || convert_to('sha256:' || encode(p_invite_record_root, 'hex'), 'UTF8')
    || decode('00', 'hex')
    || convert_to('sha256:' || encode(p_guest_profile_record_root, 'hex'), 'UTF8')
  );
  RETURN hestia.hcv1_blob_put(v_digest);
END;
$$;

CREATE FUNCTION hestia.environment_admission_signed_record_put(
  p_environment_id text,
  p_environment_key_root bytea,
  p_body_root bytea,
  p_environment_signature bytea
)
RETURNS TABLE (signature_root bytea, signed_record_root bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_environment hestia.environment_signer%ROWTYPE;
  v_signing_payload bytea;
BEGIN
  SELECT * INTO v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = p_environment_key_root
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepared Hestia environment signer is no longer active';
  END IF;
  IF p_environment_signature IS NULL
     OR octet_length(p_environment_signature) <> 64 THEN
    RAISE EXCEPTION 'Hestia admission receipt requires a 64-byte Ed25519 signature';
  END IF;
  v_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:' || encode(p_body_root, 'hex'),
    'UTF8'
  );
  IF NOT gw_ledger.signature_verify(
    p_environment_signature,
    v_signing_payload,
    v_environment.public_key
  ) THEN
    RAISE EXCEPTION 'invalid Hestia room admission signature';
  END IF;
  signature_root := hestia.hcv1_blob_put(p_environment_signature);
  signed_record_root := hestia.agent_record_put(
    'ledger/signed-record',
    ARRAY[p_body_root, p_environment_key_root, signature_root]::bytea[]
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.environment_room_policy_register(
  p_environment_id text,
  p_room_policy_root bytea,
  p_room_kernel_root bytea,
  p_allowed_invite_purposes text[]
)
RETURNS TABLE (
  room_policy_root bytea,
  room_kernel_root bytea,
  allowed_invite_purposes text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.environment_room_policy%ROWTYPE;
  v_distinct_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hestia.environment_signer
     WHERE environment_id = p_environment_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Hestia environment has no active signing key';
  END IF;
  IF p_room_policy_root IS NULL OR p_room_kernel_root IS NULL
     OR octet_length(p_room_policy_root) <> 32
     OR octet_length(p_room_kernel_root) <> 32 THEN
    RAISE EXCEPTION 'room policy and kernel must be HCV0 roots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_room_policy_root)
     OR NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_room_kernel_root) THEN
    RAISE EXCEPTION 'room policy and kernel cells must already exist';
  END IF;
  IF p_allowed_invite_purposes IS NULL
     OR cardinality(p_allowed_invite_purposes) NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'room policy must allow at least one bounded invitation purpose';
  END IF;
  SELECT count(DISTINCT purpose) INTO v_distinct_count
    FROM pg_catalog.unnest(p_allowed_invite_purposes) AS purpose;
  IF v_distinct_count <> cardinality(p_allowed_invite_purposes)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_allowed_invite_purposes) AS purpose
        WHERE purpose IS NULL OR length(purpose) NOT BETWEEN 1 AND 128
     ) THEN
    RAISE EXCEPTION 'room invitation purposes must be unique bounded strings';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_environment_id, 3));
  SELECT * INTO v_existing
    FROM hestia.environment_room_policy
   WHERE environment_id = p_environment_id;
  IF FOUND THEN
    IF v_existing.status <> 'active'
       OR v_existing.room_policy_root <> p_room_policy_root
       OR v_existing.room_kernel_root <> p_room_kernel_root
       OR v_existing.allowed_invite_purposes <> p_allowed_invite_purposes THEN
      RAISE EXCEPTION 'Hestia environment room policy conflict';
    END IF;
  ELSE
    INSERT INTO hestia.environment_room_policy (
      environment_id,
      room_policy_root,
      room_kernel_root,
      allowed_invite_purposes,
      status
    ) VALUES (
      p_environment_id,
      p_room_policy_root,
      p_room_kernel_root,
      p_allowed_invite_purposes,
      'active'
    );
  END IF;
  room_policy_root := p_room_policy_root;
  room_kernel_root := p_room_kernel_root;
  allowed_invite_purposes := p_allowed_invite_purposes;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_genesis_prepare(
  p_environment_id text,
  p_signed_record_root bytea
)
RETURNS TABLE (
  transition_sequence bigint,
  room_id text,
  result_state_root bytea,
  admission_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_room_genesis_admission%ROWTYPE;
  v_verification hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_policy hestia.environment_room_policy%ROWTYPE;
  v_host hestia.agent_profile%ROWTYPE;
  v_body_root bytea;
  v_room_id_root bytea;
  v_room_id text;
  v_room_sequence bigint;
  v_previous_field bytea;
  v_host_profile_root bytea;
  v_policy_root bytea;
  v_kernel_root bytea;
  v_acceptance_mode_root bytea;
  v_acceptance_mode text;
  v_owner_purposes text[] := ARRAY[
    'document.attach',
    'negotiation.accept',
    'negotiation.propose',
    'room.invite',
    'room.message'
  ]::text[];
  v_owner_role_root bytea;
  v_owner_purposes_root bytea;
  v_active_root bytea;
  v_epoch_root bytea;
  v_nil_root bytea;
  v_owner_member_state_root bytea;
  v_members_root bytea;
  v_invitations_root bytea;
  v_result_state_root bytea;
  v_effect_plan_root bytea;
  v_outcome_root bytea;
  v_transition_sequence bigint;
  v_transition_sequence_root bytea;
  v_admission_receipt_root bytea;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.agent_room_genesis_admission
   WHERE signed_record_root = p_signed_record_root;
  IF FOUND THEN
    transition_sequence := v_existing.transition_sequence;
    room_id := v_existing.room_id;
    result_state_root := v_existing.result_state_root;
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
    FROM hestia.agent_record_verification
   WHERE signed_record_root = p_signed_record_root
     AND record_kind = 'room/version'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room version requires a verified Hestia receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = v_verification.environment_key_root
     AND status = 'active';
  SELECT * INTO STRICT v_policy
    FROM hestia.environment_room_policy
   WHERE environment_id = p_environment_id
     AND status = 'active';

  v_body_root := v_verification.body_root;
  v_room_id_root := gw_ledger.cell_ref_child(v_body_root, 0, 'room-id');
  v_room_id := hestia.hcv1_text(v_room_id_root);
  v_room_sequence := hestia.hcv1_bigint(
    gw_ledger.cell_ref_child(v_body_root, 1, 'sequence')
  );
  v_previous_field := gw_ledger.cell_ref_child(v_body_root, 2, 'previous-room');
  v_host_profile_root := gw_ledger.cell_ref_child(v_body_root, 3, 'host-profile');
  v_policy_root := gw_ledger.cell_ref_child(v_body_root, 4, 'policy');
  v_kernel_root := gw_ledger.cell_ref_child(v_body_root, 5, 'kernel');
  v_acceptance_mode_root := gw_ledger.cell_ref_child(
    v_body_root, 6, 'acceptance-mode'
  );
  v_acceptance_mode := hestia.hcv1_text(v_acceptance_mode_root);

  IF length(v_room_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'room identifier is outside the admission bound';
  END IF;
  IF v_room_sequence <> 1 OR NOT hestia.hcv1_is_nil(v_previous_field) THEN
    RAISE EXCEPTION 'room genesis must have sequence one and no predecessor';
  END IF;
  IF v_policy_root <> v_policy.room_policy_root
     OR v_kernel_root <> v_policy.room_kernel_root THEN
    RAISE EXCEPTION 'room genesis does not bind the active room policy and kernel';
  END IF;
  IF v_acceptance_mode <> 'human-required' THEN
    RAISE EXCEPTION 'room genesis must require human acceptance';
  END IF;

  SELECT * INTO v_host
    FROM hestia.agent_profile
   WHERE current_record_root = v_host_profile_root
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room host profile is not an admitted active profile';
  END IF;
  IF NOT hestia.agent_profile_authorized(
    v_host.profile_id,
    v_host.current_record_root,
    v_verification.signer_key_root,
    'room.create'
  ) THEN
    RAISE EXCEPTION 'room genesis is not signed by an authorized host operational key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_room_id, 4));
  IF EXISTS (SELECT 1 FROM hestia.agent_room WHERE room_id = v_room_id) THEN
    RAISE EXCEPTION 'room already exists: %', v_room_id;
  END IF;

  v_transition_sequence := nextval('hestia.agent_room_transition_sequence'::regclass);
  v_owner_role_root := hestia.hcv1_string_put('owner');
  v_owner_purposes_root := hestia.hcv1_vector_strings_put(v_owner_purposes);
  v_active_root := hestia.hcv1_string_put('active');
  v_epoch_root := hestia.hcv1_integer_put(1);
  v_nil_root := hestia.hcv1_nil_put();
  v_owner_member_state_root := hestia.agent_record_put(
    'room/member-state',
    ARRAY[
      p_signed_record_root,
      v_host.current_record_root,
      v_owner_role_root,
      v_owner_purposes_root,
      v_active_root,
      v_epoch_root,
      v_nil_root,
      v_host.delegation_root
    ]::bytea[]
  );
  v_members_root := hestia.hcv1_vector_put(
    ARRAY[v_owner_member_state_root]::bytea[]
  );
  v_invitations_root := hestia.hcv1_vector_put(ARRAY[]::bytea[]);
  v_result_state_root := hestia.agent_room_state_put(
    v_room_id_root,
    p_signed_record_root,
    v_host.current_record_root,
    1,
    v_members_root,
    v_invitations_root,
    v_policy_root,
    v_kernel_root,
    v_acceptance_mode_root,
    'open'
  );
  v_effect_plan_root := hestia.hcv1_string_put('room-genesis-and-owner-admit');
  v_outcome_root := hestia.hcv1_string_put('accepted');
  v_transition_sequence_root := hestia.hcv1_integer_put(v_transition_sequence);
  v_admission_receipt_root := hestia.agent_record_put(
    'ledger/admission-receipt',
    ARRAY[
      v_nil_root,
      v_body_root,
      v_policy_root,
      v_kernel_root,
      v_result_state_root,
      v_effect_plan_root,
      p_signed_record_root,
      v_outcome_root,
      v_transition_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_room_genesis_admission (
    transition_sequence,
    signed_record_root,
    room_id,
    room_sequence,
    body_root,
    verification_signed_receipt_root,
    host_profile_id,
    expected_host_profile_record_root,
    expected_host_profile_state_root,
    host_operational_key_root,
    host_delegation_root,
    owner_member_state_root,
    members_root,
    invitations_root,
    result_state_root,
    policy_root,
    kernel_root,
    acceptance_mode,
    effect_plan_root,
    outcome_root,
    admission_receipt_root,
    environment_id,
    environment_key_root,
    status
  ) VALUES (
    v_transition_sequence,
    p_signed_record_root,
    v_room_id,
    v_room_sequence,
    v_body_root,
    v_verification.signed_receipt_root,
    v_host.profile_id,
    v_host.current_record_root,
    v_host.current_state_root,
    v_host.operational_key_root,
    v_host.delegation_root,
    v_owner_member_state_root,
    v_members_root,
    v_invitations_root,
    v_result_state_root,
    v_policy_root,
    v_kernel_root,
    v_acceptance_mode,
    v_effect_plan_root,
    v_outcome_root,
    v_admission_receipt_root,
    p_environment_id,
    v_environment.key_root,
    'pending-signature'
  );

  transition_sequence := v_transition_sequence;
  room_id := v_room_id;
  result_state_root := v_result_state_root;
  admission_receipt_root := v_admission_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:' || encode(v_admission_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_genesis_commit(
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
  v_row hestia.agent_room_genesis_admission%ROWTYPE;
  v_host hestia.agent_profile%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_nil_root bytea;
  v_owner_purposes text[] := ARRAY[
    'document.attach',
    'negotiation.accept',
    'negotiation.propose',
    'room.invite',
    'room.message'
  ]::text[];
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_room_genesis_admission
   WHERE signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room genesis has not been prepared for admission';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'room genesis was prepared for another environment';
  END IF;
  IF v_row.status = 'accepted' THEN
    RETURN v_row.admission_signed_receipt_root;
  END IF;

  SELECT * INTO v_host
    FROM hestia.agent_profile
   WHERE profile_id = v_row.host_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_host.current_record_root <> v_row.expected_host_profile_record_root
     OR v_host.current_state_root <> v_row.expected_host_profile_state_root
     OR v_host.operational_key_root <> v_row.host_operational_key_root
     OR v_host.delegation_root <> v_row.host_delegation_root
     OR v_host.status <> 'active' THEN
    RAISE EXCEPTION 'room host profile changed after genesis preparation';
  END IF;
  IF NOT hestia.agent_profile_authorized(
    v_host.profile_id,
    v_host.current_record_root,
    v_row.host_operational_key_root,
    'room.create'
  ) THEN
    RAISE EXCEPTION 'room host no longer has room.create authority';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_row.room_id, 4));
  IF EXISTS (SELECT 1 FROM hestia.agent_room WHERE room_id = v_row.room_id) THEN
    RAISE EXCEPTION 'room appeared after genesis preparation';
  END IF;

  SELECT signature_root, signed_record_root
    INTO v_signature_root, v_signed_receipt_root
    FROM hestia.environment_admission_signed_record_put(
      p_environment_id,
      v_row.environment_key_root,
      v_row.admission_receipt_root,
      p_environment_signature
    );
  v_nil_root := hestia.hcv1_nil_put();

  INSERT INTO hestia.agent_room_version (
    room_id,
    sequence,
    signed_record_root,
    body_root,
    previous_record_root,
    host_profile_id,
    host_profile_record_root,
    policy_root,
    kernel_root,
    acceptance_mode,
    verification_signed_receipt_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    1,
    v_row.signed_record_root,
    v_row.body_root,
    NULL,
    v_row.host_profile_id,
    v_row.expected_host_profile_record_root,
    v_row.policy_root,
    v_row.kernel_root,
    v_row.acceptance_mode,
    v_row.verification_signed_receipt_root,
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_room (
    room_id,
    current_sequence,
    current_record_root,
    current_body_root,
    current_state_root,
    host_profile_id,
    host_profile_record_root,
    policy_root,
    kernel_root,
    acceptance_mode,
    membership_epoch,
    members_root,
    invitations_root,
    status,
    last_transition_sequence,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    1,
    v_row.signed_record_root,
    v_row.body_root,
    v_row.result_state_root,
    v_row.host_profile_id,
    v_row.expected_host_profile_record_root,
    v_row.policy_root,
    v_row.kernel_root,
    v_row.acceptance_mode,
    1,
    v_row.members_root,
    v_row.invitations_root,
    'open',
    v_row.transition_sequence,
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_room_member (
    room_id,
    member_profile_id,
    member_profile_record_root,
    current_state_root,
    role,
    purposes,
    status,
    joined_epoch,
    revoked_epoch,
    delegation_root,
    admitted_by_record_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.host_profile_id,
    v_row.expected_host_profile_record_root,
    v_row.owner_member_state_root,
    'owner',
    v_owner_purposes,
    'active',
    1,
    NULL,
    v_row.host_delegation_root,
    v_row.signed_record_root,
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_room_member_version (
    room_id,
    member_profile_id,
    transition_sequence,
    state_root,
    previous_state_root,
    member_profile_record_root,
    role,
    purposes,
    status,
    joined_epoch,
    revoked_epoch,
    delegation_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.host_profile_id,
    v_row.transition_sequence,
    v_row.owner_member_state_root,
    v_nil_root,
    v_row.expected_host_profile_record_root,
    'owner',
    v_owner_purposes,
    'active',
    1,
    NULL,
    v_row.host_delegation_root,
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_room_state_version (
    room_id,
    transition_sequence,
    state_root,
    previous_state_root,
    event_record_root,
    membership_epoch,
    members_root,
    invitations_root,
    effect_plan_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.transition_sequence,
    v_row.result_state_root,
    v_nil_root,
    v_row.signed_record_root,
    1,
    v_row.members_root,
    v_row.invitations_root,
    v_row.effect_plan_root,
    v_signed_receipt_root
  );

  UPDATE hestia.agent_room_genesis_admission
     SET environment_signature_root = v_signature_root,
         admission_signed_receipt_root = v_signed_receipt_root,
         status = 'accepted',
         accepted_at = clock_timestamp()
   WHERE signed_record_root = p_signed_record_root;

  RETURN v_signed_receipt_root;
END;
$$;

CREATE FUNCTION hestia.agent_room_invitation_prepare(
  p_environment_id text,
  p_signed_record_root bytea
)
RETURNS TABLE (
  transition_sequence bigint,
  invite_id text,
  result_room_state_root bytea,
  admission_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_room_invitation_admission%ROWTYPE;
  v_verification hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_policy hestia.environment_room_policy%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_host hestia.agent_profile%ROWTYPE;
  v_body_root bytea;
  v_invite_id text;
  v_room_id text;
  v_host_profile_id text;
  v_host_profile_root bytea;
  v_role text;
  v_purposes text[];
  v_distinct_purpose_count integer;
  v_expires_at timestamptz;
  v_capability_commitment_root bytea;
  v_capability_payload bytea;
  v_one_time boolean;
  v_active_root bytea;
  v_nil_root bytea;
  v_invitation_state_root bytea;
  v_result_invitations_root bytea;
  v_result_room_state_root bytea;
  v_effect_plan_root bytea;
  v_outcome_root bytea;
  v_transition_sequence bigint;
  v_transition_sequence_root bytea;
  v_admission_receipt_root bytea;
  v_acceptance_mode_root bytea;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.agent_room_invitation_admission
   WHERE signed_record_root = p_signed_record_root;
  IF FOUND THEN
    transition_sequence := v_existing.transition_sequence;
    invite_id := v_existing.invite_id;
    result_room_state_root := v_existing.result_room_state_root;
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
    FROM hestia.agent_record_verification
   WHERE signed_record_root = p_signed_record_root
     AND record_kind = 'room/invitation'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room invitation requires a verified Hestia receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = v_verification.environment_key_root
     AND status = 'active';
  SELECT * INTO STRICT v_policy
    FROM hestia.environment_room_policy
   WHERE environment_id = p_environment_id
     AND status = 'active';

  v_body_root := v_verification.body_root;
  v_invite_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 0, 'invite-id')
  );
  v_room_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 1, 'room')
  );
  v_host_profile_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 2, 'host-profile-id')
  );
  v_host_profile_root := gw_ledger.cell_ref_child(
    v_body_root, 3, 'host-profile'
  );
  v_role := hestia.hcv1_text(gw_ledger.cell_ref_child(v_body_root, 4, 'role'));
  v_purposes := hestia.hcv1_vector_texts(
    gw_ledger.cell_ref_child(v_body_root, 5, 'purposes')
  );
  BEGIN
    v_expires_at := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_body_root, 6, 'expires-at')
    )::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'room invitation has an invalid expiry';
  END;
  v_capability_commitment_root := gw_ledger.cell_ref_child(
    v_body_root, 7, 'capability-commitment'
  );
  v_one_time := hestia.hcv1_boolean(
    gw_ledger.cell_ref_child(v_body_root, 8, 'one-time')
  );

  IF length(v_invite_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'invitation identifier is outside the admission bound';
  END IF;
  IF v_role NOT IN ('participant', 'observer', 'negotiator') THEN
    RAISE EXCEPTION 'unsupported room invitation role: %', v_role;
  END IF;
  IF v_purposes IS NULL OR cardinality(v_purposes) NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'room invitation requires bounded purposes';
  END IF;
  SELECT count(DISTINCT purpose) INTO v_distinct_purpose_count
    FROM pg_catalog.unnest(v_purposes) AS purpose;
  IF v_distinct_purpose_count <> cardinality(v_purposes)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(v_purposes) AS purpose
        WHERE NOT (purpose = ANY(v_policy.allowed_invite_purposes))
     ) THEN
    RAISE EXCEPTION 'room invitation requests an unauthorized purpose';
  END IF;
  IF v_expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'room invitation is already expired';
  END IF;
  IF NOT v_one_time THEN
    RAISE EXCEPTION 'v0 room invitations must be single-use';
  END IF;
  IF gw_ledger.cell_type_tag(v_capability_commitment_root) <> 6 THEN
    RAISE EXCEPTION 'room capability commitment must be an HCV0 blob';
  END IF;
  SELECT payload INTO STRICT v_capability_payload
    FROM gw_ledger."Cell" WHERE hash = v_capability_commitment_root;
  IF octet_length(v_capability_payload) <> 32 THEN
    RAISE EXCEPTION 'room capability commitment must contain a SHA-256 digest';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_room_id, 5));
  SELECT * INTO v_room
    FROM hestia.agent_room
   WHERE room_id = v_room_id
     AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room invitation targets an unknown or closed room';
  END IF;
  IF v_room.policy_root <> v_policy.room_policy_root
     OR v_room.kernel_root <> v_policy.room_kernel_root THEN
    RAISE EXCEPTION 'room no longer uses the active environment policy';
  END IF;
  IF v_room.host_profile_id <> v_host_profile_id
     OR v_room.host_profile_record_root <> v_host_profile_root THEN
    RAISE EXCEPTION 'room invitation host does not match the room owner';
  END IF;

  SELECT * INTO v_host
    FROM hestia.agent_profile
   WHERE profile_id = v_host_profile_id
     AND current_record_root = v_host_profile_root
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room invitation host profile is not current';
  END IF;
  IF NOT hestia.agent_profile_authorized(
    v_host.profile_id,
    v_host.current_record_root,
    v_verification.signer_key_root,
    'room.invite'
  ) THEN
    RAISE EXCEPTION 'room invitation is not signed by an authorized host key';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hestia.agent_room_invitation
     WHERE invite_id = v_invite_id OR signed_record_root = p_signed_record_root
  ) THEN
    RAISE EXCEPTION 'room invitation already exists';
  END IF;

  v_transition_sequence := nextval('hestia.agent_room_transition_sequence'::regclass);
  v_active_root := hestia.hcv1_string_put('active');
  v_nil_root := hestia.hcv1_nil_put();
  v_invitation_state_root := hestia.agent_record_put(
    'room/invitation-state',
    ARRAY[
      p_signed_record_root,
      v_room.current_state_root,
      v_active_root,
      v_nil_root,
      v_nil_root
    ]::bytea[]
  );
  v_result_invitations_root := hestia.agent_room_invitations_vector(
    v_room_id,
    v_invite_id,
    v_invitation_state_root
  );
  v_acceptance_mode_root := hestia.hcv1_string_put(v_room.acceptance_mode);
  v_result_room_state_root := hestia.agent_room_state_put(
    hestia.hcv1_string_put(v_room.room_id),
    v_room.current_record_root,
    v_room.host_profile_record_root,
    v_room.membership_epoch,
    v_room.members_root,
    v_result_invitations_root,
    v_room.policy_root,
    v_room.kernel_root,
    v_acceptance_mode_root,
    v_room.status
  );
  v_effect_plan_root := hestia.hcv1_string_put('invitation-publish');
  v_outcome_root := hestia.hcv1_string_put('accepted');
  v_transition_sequence_root := hestia.hcv1_integer_put(v_transition_sequence);
  v_admission_receipt_root := hestia.agent_record_put(
    'ledger/admission-receipt',
    ARRAY[
      v_room.current_state_root,
      v_body_root,
      v_room.policy_root,
      v_room.kernel_root,
      v_result_room_state_root,
      v_effect_plan_root,
      p_signed_record_root,
      v_outcome_root,
      v_transition_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_room_invitation_admission (
    transition_sequence,
    signed_record_root,
    invite_id,
    room_id,
    body_root,
    verification_signed_receipt_root,
    expected_room_state_root,
    expected_host_profile_record_root,
    expected_host_profile_state_root,
    invitation_state_root,
    result_invitations_root,
    result_room_state_root,
    host_profile_id,
    role,
    purposes,
    expires_at,
    capability_commitment_root,
    one_time,
    policy_root,
    kernel_root,
    effect_plan_root,
    outcome_root,
    admission_receipt_root,
    environment_id,
    environment_key_root,
    status
  ) VALUES (
    v_transition_sequence,
    p_signed_record_root,
    v_invite_id,
    v_room_id,
    v_body_root,
    v_verification.signed_receipt_root,
    v_room.current_state_root,
    v_host.current_record_root,
    v_host.current_state_root,
    v_invitation_state_root,
    v_result_invitations_root,
    v_result_room_state_root,
    v_host_profile_id,
    v_role,
    v_purposes,
    v_expires_at,
    v_capability_commitment_root,
    v_one_time,
    v_room.policy_root,
    v_room.kernel_root,
    v_effect_plan_root,
    v_outcome_root,
    v_admission_receipt_root,
    p_environment_id,
    v_environment.key_root,
    'pending-signature'
  );

  transition_sequence := v_transition_sequence;
  invite_id := v_invite_id;
  result_room_state_root := v_result_room_state_root;
  admission_receipt_root := v_admission_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:' || encode(v_admission_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_invitation_commit(
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
  v_row hestia.agent_room_invitation_admission%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_host hestia.agent_profile%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_nil_root bytea;
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_room_invitation_admission
   WHERE signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room invitation has not been prepared for admission';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'room invitation was prepared for another environment';
  END IF;
  IF v_row.status = 'accepted' THEN
    RETURN v_row.admission_signed_receipt_root;
  END IF;

  SELECT * INTO v_room
    FROM hestia.agent_room
   WHERE room_id = v_row.room_id
   FOR UPDATE;
  IF NOT FOUND OR v_room.current_state_root <> v_row.expected_room_state_root
     OR v_room.status <> 'open' THEN
    RAISE EXCEPTION 'room state changed after invitation preparation';
  END IF;
  SELECT * INTO v_host
    FROM hestia.agent_profile
   WHERE profile_id = v_row.host_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_host.current_record_root <> v_row.expected_host_profile_record_root
     OR v_host.current_state_root <> v_row.expected_host_profile_state_root
     OR v_host.status <> 'active' THEN
    RAISE EXCEPTION 'room host profile changed after invitation preparation';
  END IF;
  IF NOT hestia.agent_profile_authorized(
    v_host.profile_id,
    v_host.current_record_root,
    v_host.operational_key_root,
    'room.invite'
  ) THEN
    RAISE EXCEPTION 'room host no longer has room.invite authority';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hestia.agent_room_invitation
     WHERE invite_id = v_row.invite_id
        OR signed_record_root = v_row.signed_record_root
  ) THEN
    RAISE EXCEPTION 'room invitation appeared after preparation';
  END IF;

  SELECT signature_root, signed_record_root
    INTO v_signature_root, v_signed_receipt_root
    FROM hestia.environment_admission_signed_record_put(
      p_environment_id,
      v_row.environment_key_root,
      v_row.admission_receipt_root,
      p_environment_signature
    );
  v_nil_root := hestia.hcv1_nil_put();

  INSERT INTO hestia.agent_room_invitation (
    invite_id,
    room_id,
    signed_record_root,
    body_root,
    host_profile_id,
    host_profile_record_root,
    role,
    purposes,
    expires_at,
    capability_commitment_root,
    one_time,
    current_state_root,
    status,
    issued_signed_receipt_root
  ) VALUES (
    v_row.invite_id,
    v_row.room_id,
    v_row.signed_record_root,
    v_row.body_root,
    v_row.host_profile_id,
    v_row.expected_host_profile_record_root,
    v_row.role,
    v_row.purposes,
    v_row.expires_at,
    v_row.capability_commitment_root,
    v_row.one_time,
    v_row.invitation_state_root,
    'active',
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_room_invitation_version (
    invite_id,
    transition_sequence,
    room_id,
    state_root,
    previous_state_root,
    signed_record_root,
    status,
    consumed_by_profile_id,
    consumed_by_record_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.invite_id,
    v_row.transition_sequence,
    v_row.room_id,
    v_row.invitation_state_root,
    v_nil_root,
    v_row.signed_record_root,
    'active',
    NULL,
    NULL,
    v_signed_receipt_root
  );

  UPDATE hestia.agent_room
     SET current_state_root = v_row.result_room_state_root,
         invitations_root = v_row.result_invitations_root,
         last_transition_sequence = v_row.transition_sequence,
         admission_signed_receipt_root = v_signed_receipt_root,
         updated_at = clock_timestamp()
   WHERE room_id = v_row.room_id;

  INSERT INTO hestia.agent_room_state_version (
    room_id,
    transition_sequence,
    state_root,
    previous_state_root,
    event_record_root,
    membership_epoch,
    members_root,
    invitations_root,
    effect_plan_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.transition_sequence,
    v_row.result_room_state_root,
    v_row.expected_room_state_root,
    v_row.signed_record_root,
    v_room.membership_epoch,
    v_room.members_root,
    v_row.result_invitations_root,
    v_row.effect_plan_root,
    v_signed_receipt_root
  );

  UPDATE hestia.agent_room_invitation_admission
     SET environment_signature_root = v_signature_root,
         admission_signed_receipt_root = v_signed_receipt_root,
         status = 'accepted',
         accepted_at = clock_timestamp()
   WHERE signed_record_root = p_signed_record_root;

  RETURN v_signed_receipt_root;
END;
$$;

CREATE FUNCTION hestia.agent_room_member_prepare(
  p_environment_id text,
  p_signed_record_root bytea,
  p_capability bytea
)
RETURNS TABLE (
  transition_sequence bigint,
  room_id text,
  member_profile_id text,
  next_membership_epoch bigint,
  result_room_state_root bytea,
  admission_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_room_member_admission%ROWTYPE;
  v_verification hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_policy hestia.environment_room_policy%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_invitation hestia.agent_room_invitation%ROWTYPE;
  v_guest hestia.agent_profile%ROWTYPE;
  v_body_root bytea;
  v_proof_id text;
  v_invite_record_root bytea;
  v_invite_id text;
  v_room_id text;
  v_guest_profile_id text;
  v_guest_profile_record_root bytea;
  v_guest_key_id text;
  v_capability_proof_root bytea;
  v_expected_capability_commitment_root bytea;
  v_expected_capability_proof_root bytea;
  v_role_root bytea;
  v_purposes_root bytea;
  v_active_root bytea;
  v_consumed_root bytea;
  v_nil_root bytea;
  v_next_membership_epoch bigint;
  v_next_membership_epoch_root bytea;
  v_guest_member_state_root bytea;
  v_consumed_invitation_state_root bytea;
  v_result_members_root bytea;
  v_result_invitations_root bytea;
  v_result_room_state_root bytea;
  v_acceptance_mode_root bytea;
  v_effect_plan_root bytea;
  v_outcome_root bytea;
  v_transition_sequence bigint;
  v_transition_sequence_root bytea;
  v_admission_receipt_root bytea;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.agent_room_member_admission
   WHERE signed_record_root = p_signed_record_root;
  IF FOUND THEN
    transition_sequence := v_existing.transition_sequence;
    room_id := v_existing.room_id;
    member_profile_id := v_existing.guest_profile_id;
    next_membership_epoch := v_existing.next_membership_epoch;
    result_room_state_root := v_existing.result_room_state_root;
    admission_receipt_root := v_existing.admission_receipt_root;
    receipt_signing_payload := convert_to(
      'GWAR0:ledger/admission-receipt:'
      || encode(v_existing.admission_receipt_root, 'hex'),
      'UTF8'
    );
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_capability IS NULL OR octet_length(p_capability) <> 32 THEN
    RAISE EXCEPTION 'room admission capability must be 32 bytes';
  END IF;

  SELECT * INTO v_verification
    FROM hestia.agent_record_verification
   WHERE signed_record_root = p_signed_record_root
     AND record_kind = 'room/admission-proof'
     AND environment_id = p_environment_id
     AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room admission proof requires a verified Hestia receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer
   WHERE environment_id = p_environment_id
     AND key_root = v_verification.environment_key_root
     AND status = 'active';
  SELECT * INTO STRICT v_policy
    FROM hestia.environment_room_policy
   WHERE environment_id = p_environment_id
     AND status = 'active';

  v_body_root := v_verification.body_root;
  v_proof_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 0, 'proof-id')
  );
  v_invite_record_root := gw_ledger.cell_ref_child(
    v_body_root, 1, 'invitation'
  );
  v_invite_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 2, 'invite-id')
  );
  v_room_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 3, 'room')
  );
  v_guest_profile_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 4, 'guest-profile-id')
  );
  v_guest_profile_record_root := gw_ledger.cell_ref_child(
    v_body_root, 5, 'guest-profile'
  );
  v_guest_key_id := hestia.hcv1_text(
    gw_ledger.cell_ref_child(v_body_root, 6, 'guest-key')
  );
  v_capability_proof_root := gw_ledger.cell_ref_child(
    v_body_root, 7, 'capability-proof'
  );

  IF length(v_proof_id) NOT BETWEEN 1 AND 256
     OR length(v_invite_id) NOT BETWEEN 1 AND 256
     OR length(v_room_id) NOT BETWEEN 1 AND 256
     OR length(v_guest_profile_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'room admission identifiers are outside the admission bound';
  END IF;
  IF gw_ledger.cell_type_tag(v_capability_proof_root) <> 6
     OR (SELECT octet_length(payload)
           FROM gw_ledger."Cell"
          WHERE hash = v_capability_proof_root) <> 32 THEN
    RAISE EXCEPTION 'room admission proof commitment must be a SHA-256 HCV0 blob';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_room_id, 6));
  SELECT * INTO v_room
    FROM hestia.agent_room
   WHERE room_id = v_room_id
     AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room admission targets an unknown or closed room';
  END IF;
  IF v_room.policy_root <> v_policy.room_policy_root
     OR v_room.kernel_root <> v_policy.room_kernel_root THEN
    RAISE EXCEPTION 'room no longer uses the active environment policy';
  END IF;

  SELECT * INTO v_invitation
    FROM hestia.agent_room_invitation
   WHERE invite_id = v_invite_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_invitation.room_id <> v_room_id
     OR v_invitation.signed_record_root <> v_invite_record_root THEN
    RAISE EXCEPTION 'room admission does not bind the active invitation';
  END IF;
  IF v_invitation.status <> 'active'
     OR NOT v_invitation.one_time
     OR v_invitation.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'room invitation is no longer admissible';
  END IF;

  SELECT * INTO v_guest
    FROM hestia.agent_profile
   WHERE profile_id = v_guest_profile_id
     AND current_record_root = v_guest_profile_record_root
     AND status = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guest profile is not currently admitted';
  END IF;
  IF v_verification.signer_key_root <> v_guest.operational_key_root
     OR v_guest_key_id <> 'ed25519:' || encode(v_guest.operational_key_root, 'hex')
     OR NOT hestia.agent_profile_authorized(
       v_guest.profile_id,
       v_guest.current_record_root,
       v_verification.signer_key_root,
       'room.join'
     ) THEN
    RAISE EXCEPTION 'room admission proof is not signed by the guest operational key';
  END IF;

  v_expected_capability_commitment_root :=
    hestia.room_capability_commitment_root(v_invite_id, p_capability);
  IF v_expected_capability_commitment_root <>
     v_invitation.capability_commitment_root THEN
    RAISE EXCEPTION 'room admission capability does not match the invitation';
  END IF;
  v_expected_capability_proof_root := hestia.room_admission_proof_root(
    p_capability,
    v_invite_record_root,
    v_guest_profile_record_root
  );
  IF v_expected_capability_proof_root <> v_capability_proof_root THEN
    RAISE EXCEPTION 'room admission capability proof mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hestia.agent_room_member
     WHERE room_id = v_room_id
       AND member_profile_id = v_guest_profile_id
  ) THEN
    RAISE EXCEPTION 'guest profile is already a room member';
  END IF;

  v_transition_sequence := nextval('hestia.agent_room_transition_sequence'::regclass);
  v_next_membership_epoch := v_room.membership_epoch + 1;
  IF v_next_membership_epoch <= v_room.membership_epoch THEN
    RAISE EXCEPTION 'room membership epoch overflow';
  END IF;
  v_role_root := hestia.hcv1_string_put(v_invitation.role);
  v_purposes_root := hestia.hcv1_vector_strings_put(v_invitation.purposes);
  v_active_root := hestia.hcv1_string_put('active');
  v_consumed_root := hestia.hcv1_string_put('consumed');
  v_nil_root := hestia.hcv1_nil_put();
  v_next_membership_epoch_root := hestia.hcv1_integer_put(
    v_next_membership_epoch
  );
  v_guest_member_state_root := hestia.agent_record_put(
    'room/member-state',
    ARRAY[
      v_room.current_record_root,
      v_guest.current_record_root,
      v_role_root,
      v_purposes_root,
      v_active_root,
      v_next_membership_epoch_root,
      v_nil_root,
      v_guest.delegation_root
    ]::bytea[]
  );
  v_consumed_invitation_state_root := hestia.agent_record_put(
    'room/invitation-state',
    ARRAY[
      v_invitation.signed_record_root,
      v_room.current_state_root,
      v_consumed_root,
      v_guest.current_record_root,
      p_signed_record_root
    ]::bytea[]
  );
  v_result_members_root := hestia.agent_room_members_vector(
    v_room_id,
    v_guest_profile_id,
    v_guest_member_state_root
  );
  v_result_invitations_root := hestia.agent_room_invitations_vector(
    v_room_id,
    v_invite_id,
    v_consumed_invitation_state_root
  );
  v_acceptance_mode_root := hestia.hcv1_string_put(v_room.acceptance_mode);
  v_result_room_state_root := hestia.agent_room_state_put(
    hestia.hcv1_string_put(v_room.room_id),
    v_room.current_record_root,
    v_room.host_profile_record_root,
    v_next_membership_epoch,
    v_result_members_root,
    v_result_invitations_root,
    v_room.policy_root,
    v_room.kernel_root,
    v_acceptance_mode_root,
    v_room.status
  );
  v_effect_plan_root := hestia.hcv1_string_put('member-admit-and-rotate');
  v_outcome_root := hestia.hcv1_string_put('accepted');
  v_transition_sequence_root := hestia.hcv1_integer_put(v_transition_sequence);
  v_admission_receipt_root := hestia.agent_record_put(
    'ledger/admission-receipt',
    ARRAY[
      v_room.current_state_root,
      v_body_root,
      v_room.policy_root,
      v_room.kernel_root,
      v_result_room_state_root,
      v_effect_plan_root,
      p_signed_record_root,
      v_outcome_root,
      v_transition_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_room_member_admission (
    transition_sequence,
    signed_record_root,
    proof_id,
    invite_id,
    invite_record_root,
    room_id,
    body_root,
    verification_signed_receipt_root,
    expected_room_state_root,
    expected_membership_epoch,
    expected_invitation_state_root,
    expected_guest_profile_record_root,
    expected_guest_profile_state_root,
    guest_profile_id,
    guest_operational_key_root,
    guest_delegation_root,
    role,
    purposes,
    next_membership_epoch,
    guest_member_state_root,
    consumed_invitation_state_root,
    result_members_root,
    result_invitations_root,
    result_room_state_root,
    policy_root,
    kernel_root,
    effect_plan_root,
    outcome_root,
    admission_receipt_root,
    environment_id,
    environment_key_root,
    status
  ) VALUES (
    v_transition_sequence,
    p_signed_record_root,
    v_proof_id,
    v_invite_id,
    v_invite_record_root,
    v_room_id,
    v_body_root,
    v_verification.signed_receipt_root,
    v_room.current_state_root,
    v_room.membership_epoch,
    v_invitation.current_state_root,
    v_guest.current_record_root,
    v_guest.current_state_root,
    v_guest_profile_id,
    v_guest.operational_key_root,
    v_guest.delegation_root,
    v_invitation.role,
    v_invitation.purposes,
    v_next_membership_epoch,
    v_guest_member_state_root,
    v_consumed_invitation_state_root,
    v_result_members_root,
    v_result_invitations_root,
    v_result_room_state_root,
    v_room.policy_root,
    v_room.kernel_root,
    v_effect_plan_root,
    v_outcome_root,
    v_admission_receipt_root,
    p_environment_id,
    v_environment.key_root,
    'pending-signature'
  );

  transition_sequence := v_transition_sequence;
  room_id := v_room_id;
  member_profile_id := v_guest_profile_id;
  next_membership_epoch := v_next_membership_epoch;
  result_room_state_root := v_result_room_state_root;
  admission_receipt_root := v_admission_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:' || encode(v_admission_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_member_commit(
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
  v_row hestia.agent_room_member_admission%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_invitation hestia.agent_room_invitation%ROWTYPE;
  v_guest hestia.agent_profile%ROWTYPE;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
  v_nil_root bytea;
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_room_member_admission
   WHERE signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room member has not been prepared for admission';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'room member admission was prepared for another environment';
  END IF;
  IF v_row.status = 'accepted' THEN
    RETURN v_row.admission_signed_receipt_root;
  END IF;

  SELECT * INTO v_room
    FROM hestia.agent_room
   WHERE room_id = v_row.room_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_room.current_state_root <> v_row.expected_room_state_root
     OR v_room.membership_epoch <> v_row.expected_membership_epoch
     OR v_room.policy_root <> v_row.policy_root
     OR v_room.kernel_root <> v_row.kernel_root
     OR v_room.status <> 'open' THEN
    RAISE EXCEPTION 'room state changed after member admission preparation';
  END IF;

  SELECT * INTO v_invitation
    FROM hestia.agent_room_invitation
   WHERE invite_id = v_row.invite_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_invitation.signed_record_root <> v_row.invite_record_root
     OR v_invitation.current_state_root <> v_row.expected_invitation_state_root
     OR v_invitation.room_id <> v_row.room_id
     OR v_invitation.status <> 'active'
     OR NOT v_invitation.one_time
     OR v_invitation.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'room invitation changed after member admission preparation';
  END IF;

  SELECT * INTO v_guest
    FROM hestia.agent_profile
   WHERE profile_id = v_row.guest_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_guest.current_record_root <> v_row.expected_guest_profile_record_root
     OR v_guest.current_state_root <> v_row.expected_guest_profile_state_root
     OR v_guest.operational_key_root <> v_row.guest_operational_key_root
     OR v_guest.delegation_root <> v_row.guest_delegation_root
     OR v_guest.status <> 'active' THEN
    RAISE EXCEPTION 'guest profile changed after member admission preparation';
  END IF;
  IF NOT hestia.agent_profile_authorized(
    v_guest.profile_id,
    v_guest.current_record_root,
    v_guest.operational_key_root,
    'room.join'
  ) THEN
    RAISE EXCEPTION 'guest profile no longer has room.join authority';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hestia.agent_room_member
     WHERE room_id = v_row.room_id
       AND member_profile_id = v_row.guest_profile_id
  ) THEN
    RAISE EXCEPTION 'guest profile became a room member after preparation';
  END IF;

  SELECT signature_root, signed_record_root
    INTO v_signature_root, v_signed_receipt_root
    FROM hestia.environment_admission_signed_record_put(
      p_environment_id,
      v_row.environment_key_root,
      v_row.admission_receipt_root,
      p_environment_signature
    );
  v_nil_root := hestia.hcv1_nil_put();

  INSERT INTO hestia.agent_room_member (
    room_id,
    member_profile_id,
    member_profile_record_root,
    current_state_root,
    role,
    purposes,
    status,
    joined_epoch,
    revoked_epoch,
    delegation_root,
    admitted_by_record_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.guest_profile_id,
    v_row.expected_guest_profile_record_root,
    v_row.guest_member_state_root,
    v_row.role,
    v_row.purposes,
    'active',
    v_row.next_membership_epoch,
    NULL,
    v_row.guest_delegation_root,
    v_row.signed_record_root,
    v_signed_receipt_root
  );

  INSERT INTO hestia.agent_room_member_version (
    room_id,
    member_profile_id,
    transition_sequence,
    state_root,
    previous_state_root,
    member_profile_record_root,
    role,
    purposes,
    status,
    joined_epoch,
    revoked_epoch,
    delegation_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.guest_profile_id,
    v_row.transition_sequence,
    v_row.guest_member_state_root,
    v_nil_root,
    v_row.expected_guest_profile_record_root,
    v_row.role,
    v_row.purposes,
    'active',
    v_row.next_membership_epoch,
    NULL,
    v_row.guest_delegation_root,
    v_signed_receipt_root
  );

  UPDATE hestia.agent_room_invitation
     SET current_state_root = v_row.consumed_invitation_state_root,
         status = 'consumed',
         consumed_by_profile_id = v_row.guest_profile_id,
         consumed_by_record_root = v_row.signed_record_root,
         consumed_signed_receipt_root = v_signed_receipt_root,
         updated_at = clock_timestamp()
   WHERE invite_id = v_row.invite_id;

  INSERT INTO hestia.agent_room_invitation_version (
    invite_id,
    transition_sequence,
    room_id,
    state_root,
    previous_state_root,
    signed_record_root,
    status,
    consumed_by_profile_id,
    consumed_by_record_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.invite_id,
    v_row.transition_sequence,
    v_row.room_id,
    v_row.consumed_invitation_state_root,
    v_row.expected_invitation_state_root,
    v_row.invite_record_root,
    'consumed',
    v_row.guest_profile_id,
    v_row.signed_record_root,
    v_signed_receipt_root
  );

  UPDATE hestia.agent_room
     SET current_state_root = v_row.result_room_state_root,
         membership_epoch = v_row.next_membership_epoch,
         members_root = v_row.result_members_root,
         invitations_root = v_row.result_invitations_root,
         last_transition_sequence = v_row.transition_sequence,
         admission_signed_receipt_root = v_signed_receipt_root,
         updated_at = clock_timestamp()
   WHERE room_id = v_row.room_id;

  INSERT INTO hestia.agent_room_state_version (
    room_id,
    transition_sequence,
    state_root,
    previous_state_root,
    event_record_root,
    membership_epoch,
    members_root,
    invitations_root,
    effect_plan_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.transition_sequence,
    v_row.result_room_state_root,
    v_row.expected_room_state_root,
    v_row.signed_record_root,
    v_row.next_membership_epoch,
    v_row.result_members_root,
    v_row.result_invitations_root,
    v_row.effect_plan_root,
    v_signed_receipt_root
  );

  UPDATE hestia.agent_room_member_admission
     SET environment_signature_root = v_signature_root,
         admission_signed_receipt_root = v_signed_receipt_root,
         status = 'accepted',
         accepted_at = clock_timestamp()
   WHERE signed_record_root = p_signed_record_root;

  RETURN v_signed_receipt_root;
END;
$$;

CREATE TRIGGER agent_room_version_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_version
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER agent_room_state_version_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_state_version
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER agent_room_member_version_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_member_version
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER agent_room_invitation_version_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_invitation_version
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

REVOKE ALL ON hestia.environment_room_policy FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_version FROM PUBLIC;
REVOKE ALL ON hestia.agent_room FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_state_version FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_member FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_member_version FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_invitation FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_invitation_version FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_genesis_admission FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_invitation_admission FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_member_admission FROM PUBLIC;
REVOKE ALL ON SEQUENCE hestia.agent_room_transition_sequence FROM PUBLIC;

REVOKE ALL ON FUNCTION hestia.hcv1_boolean(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_vector_put(bytea[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.hcv1_vector_strings_put(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_profile_authorized(text, bytea, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_members_vector(text, text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_invitations_vector(text, text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_state_put(bytea, bytea, bytea, bigint, bytea, bytea, bytea, bytea, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.room_capability_commitment_root(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.room_admission_proof_root(bytea, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.environment_admission_signed_record_put(text, bytea, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.environment_room_policy_register(text, bytea, bytea, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_genesis_prepare(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_genesis_commit(text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_invitation_prepare(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_invitation_commit(text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_member_prepare(text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_member_commit(text, bytea, bytea) FROM PUBLIC;

GRANT SELECT ON hestia.agent_room_version TO hestia_app;
GRANT SELECT ON hestia.agent_room TO hestia_app;
GRANT SELECT ON hestia.agent_room_state_version TO hestia_app;
GRANT SELECT ON hestia.agent_room_member TO hestia_app;
GRANT SELECT ON hestia.agent_room_member_version TO hestia_app;
GRANT SELECT ON hestia.agent_room_invitation TO hestia_app;
GRANT SELECT ON hestia.agent_room_invitation_version TO hestia_app;
GRANT SELECT ON hestia.agent_room_genesis_admission TO hestia_app;
GRANT SELECT ON hestia.agent_room_invitation_admission TO hestia_app;
GRANT SELECT ON hestia.agent_room_member_admission TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_genesis_prepare(text, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_genesis_commit(text, bytea, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_invitation_prepare(text, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_invitation_commit(text, bytea, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_member_prepare(text, bytea, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_member_commit(text, bytea, bytea) TO hestia_app;

COMMENT ON TABLE hestia.agent_room IS
  'Current projection of a signed Hestia room; canonical history remains in room state/version cells and signed admission receipts.';
COMMENT ON TABLE hestia.agent_room_invitation IS
  'Current one-time invitation projection. It stores only the capability commitment; the capability itself is transient input to member admission.';
COMMENT ON FUNCTION hestia.agent_room_genesis_prepare(text, bytea) IS
  'Validates signed room genesis against the current host profile and pinned room policy, then returns exact environment admission signing bytes.';
COMMENT ON FUNCTION hestia.agent_room_invitation_prepare(text, bytea) IS
  'Validates a host-operational-key-signed invitation and advances the canonical room invitation state without receiving the secret capability.';
COMMENT ON FUNCTION hestia.agent_room_member_prepare(text, bytea, bytea) IS
  'Recomputes the invitation and guest capability proofs from transient secret input, consumes one invitation, advances the membership epoch, and returns exact environment admission signing bytes.';
COMMENT ON FUNCTION hestia.agent_room_member_commit(text, bytea, bytea) IS
  'Rechecks room, invitation, and guest profile heads; verifies the environment signature; admits the guest; consumes the invitation; and commits the epoch rotation atomically.';
