CREATE TABLE hestia.environment_room_activity_policy (
  environment_id text PRIMARY KEY,
  document_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  message_delivery_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK ((status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

ALTER TABLE hestia.agent_room
  ADD COLUMN activity_sequence bigint NOT NULL DEFAULT 0
    CHECK (activity_sequence >= 0),
  ADD COLUMN activity_head_root bytea REFERENCES gw_ledger."Cell"(hash),
  ADD CONSTRAINT agent_room_activity_head_consistent
    CHECK ((activity_sequence = 0 AND activity_head_root IS NULL)
        OR (activity_sequence > 0 AND activity_head_root IS NOT NULL));

CREATE TABLE hestia.agent_room_activity (
  room_id text NOT NULL REFERENCES hestia.agent_room(room_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  activity_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  previous_activity_root bytea REFERENCES gw_ledger."Cell"(hash),
  room_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  event_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  event_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  activity_kind text NOT NULL
    CHECK (activity_kind IN ('document-attachment', 'message-intent')),
  actor_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  actor_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  activity_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  effect_plan_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, sequence)
);

CREATE TABLE hestia.agent_room_document_attachment (
  attachment_record_root bytea PRIMARY KEY REFERENCES gw_ledger."Cell"(hash),
  attachment_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  room_id text NOT NULL,
  activity_sequence bigint NOT NULL,
  activity_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  document_id text NOT NULL CHECK (length(document_id) BETWEEN 1 AND 256),
  document_version bigint NOT NULL CHECK (document_version > 0),
  document_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  document_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  previous_document_root bytea REFERENCES gw_ledger."Cell"(hash),
  content_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  media_type text NOT NULL CHECK (length(media_type) BETWEEN 1 AND 256),
  author_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  attached_by_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  attached_by_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  document_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  attached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (room_id, activity_sequence)
    REFERENCES hestia.agent_room_activity(room_id, sequence),
  UNIQUE (room_id, document_id, document_version)
);

CREATE TABLE hestia.agent_room_message_intent (
  intent_record_root bytea PRIMARY KEY REFERENCES gw_ledger."Cell"(hash),
  intent_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  room_id text NOT NULL,
  activity_sequence bigint NOT NULL,
  activity_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  message_id text NOT NULL CHECK (length(message_id) BETWEEN 1 AND 256),
  message_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  message_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  sender_profile_id text NOT NULL REFERENCES hestia.agent_profile(profile_id),
  sender_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  ciphertext_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  delivery_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  sent_at timestamptz NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending-delivery'
    CHECK (delivery_status IN ('pending-delivery', 'delivered', 'failed')),
  admission_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (room_id, activity_sequence)
    REFERENCES hestia.agent_room_activity(room_id, sequence),
  UNIQUE (room_id, message_id)
);

CREATE TABLE hestia.agent_room_activity_admission (
  activity_sequence bigint PRIMARY KEY CHECK (activity_sequence > 0),
  signed_record_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
  record_kind text NOT NULL
    CHECK (record_kind IN ('room/document-attachment', 'room/message-intent')),
  body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  verification_signed_receipt_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  room_id text NOT NULL,
  expected_room_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_room_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_activity_sequence bigint NOT NULL CHECK (expected_activity_sequence >= 0),
  expected_activity_head_root bytea REFERENCES gw_ledger."Cell"(hash),
  actor_profile_id text NOT NULL,
  expected_actor_profile_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_actor_profile_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  actor_operational_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  actor_delegation_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  expected_member_state_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  required_purpose text NOT NULL,
  membership_epoch bigint NOT NULL CHECK (membership_epoch > 0),
  nested_record_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  nested_body_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  nested_signer_key_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 256),
  subject_sequence bigint,
  previous_subject_root bytea REFERENCES gw_ledger."Cell"(hash),
  payload_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  media_type text,
  occurred_at timestamptz NOT NULL,
  activity_kind text NOT NULL
    CHECK (activity_kind IN ('document-attachment', 'message-intent')),
  activity_policy_root bytea NOT NULL REFERENCES gw_ledger."Cell"(hash),
  activity_root bytea NOT NULL UNIQUE REFERENCES gw_ledger."Cell"(hash),
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
  CHECK ((record_kind = 'room/document-attachment'
          AND activity_kind = 'document-attachment'
          AND required_purpose = 'document.attach'
          AND subject_sequence IS NOT NULL
          AND media_type IS NOT NULL)
      OR (record_kind = 'room/message-intent'
          AND activity_kind = 'message-intent'
          AND required_purpose = 'room.message'
          AND subject_sequence IS NULL
          AND previous_subject_root IS NULL
          AND media_type IS NULL)),
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

CREATE FUNCTION hestia.environment_room_activity_policy_register(
  p_environment_id text,
  p_document_policy_root bytea,
  p_message_delivery_policy_root bytea
)
RETURNS TABLE (
  document_policy_root bytea,
  message_delivery_policy_root bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.environment_room_activity_policy%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hestia.environment_signer
     WHERE environment_id = p_environment_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Hestia environment has no active signing key';
  END IF;
  IF p_document_policy_root IS NULL OR p_message_delivery_policy_root IS NULL
     OR octet_length(p_document_policy_root) <> 32
     OR octet_length(p_message_delivery_policy_root) <> 32 THEN
    RAISE EXCEPTION 'room activity policies must be HCV0 roots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_document_policy_root)
     OR NOT EXISTS (
       SELECT 1 FROM gw_ledger."Cell" WHERE hash = p_message_delivery_policy_root
     ) THEN
    RAISE EXCEPTION 'room activity policy cells must already exist';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_environment_id, 7));
  SELECT * INTO v_existing
    FROM hestia.environment_room_activity_policy
   WHERE environment_id = p_environment_id;
  IF FOUND THEN
    IF v_existing.status <> 'active'
       OR v_existing.document_policy_root <> p_document_policy_root
       OR v_existing.message_delivery_policy_root <> p_message_delivery_policy_root THEN
      RAISE EXCEPTION 'Hestia environment room activity policy conflict';
    END IF;
  ELSE
    INSERT INTO hestia.environment_room_activity_policy (
      environment_id,
      document_policy_root,
      message_delivery_policy_root,
      status
    ) VALUES (
      p_environment_id,
      p_document_policy_root,
      p_message_delivery_policy_root,
      'active'
    );
  END IF;
  document_policy_root := p_document_policy_root;
  message_delivery_policy_root := p_message_delivery_policy_root;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_activity_prepare(
  p_environment_id text,
  p_signed_record_root bytea
)
RETURNS TABLE (
  prepared_sequence bigint,
  prepared_activity_kind text,
  prepared_room_id text,
  result_activity_root bytea,
  admission_receipt_root bytea,
  receipt_signing_payload bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing hestia.agent_room_activity_admission%ROWTYPE;
  v_verification hestia.agent_record_verification%ROWTYPE;
  v_environment hestia.environment_signer%ROWTYPE;
  v_activity_policy hestia.environment_room_activity_policy%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_actor hestia.agent_profile%ROWTYPE;
  v_member hestia.agent_room_member%ROWTYPE;
  v_latest_document hestia.agent_room_document_attachment%ROWTYPE;
  v_body_root bytea;
  v_room_record_root bytea;
  v_actor_profile_record_root bytea;
  v_nested_record_root bytea;
  v_nested_body_root bytea;
  v_nested_signer_key_root bytea;
  v_nested_signature_root bytea;
  v_subject_id text;
  v_subject_sequence bigint;
  v_previous_subject_field bytea;
  v_previous_subject_root bytea;
  v_payload_root bytea;
  v_media_type text;
  v_occurred_at timestamptz;
  v_activity_kind text;
  v_required_purpose text;
  v_activity_policy_root bytea;
  v_effect_name text;
  v_outer_epoch bigint;
  v_nested_epoch bigint;
  v_nested_room_id text;
  v_nested_actor_id text;
  v_nested_ciphertext_root bytea;
  v_nested_ciphertext text;
  v_nested_iv text;
  v_activity_sequence bigint;
  v_previous_activity_ref bytea;
  v_activity_kind_root bytea;
  v_epoch_root bytea;
  v_sequence_root bytea;
  v_activity_root bytea;
  v_effect_plan_root bytea;
  v_outcome_root bytea;
  v_admission_receipt_root bytea;
BEGIN
  SELECT * INTO v_existing
    FROM hestia.agent_room_activity_admission AS admission
   WHERE admission.signed_record_root = p_signed_record_root;
  IF FOUND THEN
    prepared_sequence := v_existing.activity_sequence;
    prepared_activity_kind := v_existing.activity_kind;
    prepared_room_id := v_existing.room_id;
    result_activity_root := v_existing.activity_root;
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
       'room/document-attachment',
       'room/message-intent'
     )
     AND verification.environment_id = p_environment_id
     AND verification.status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room activity requires a verified Hestia receipt';
  END IF;
  SELECT * INTO STRICT v_environment
    FROM hestia.environment_signer AS signer
   WHERE signer.environment_id = p_environment_id
     AND signer.key_root = v_verification.environment_key_root
     AND signer.status = 'active';
  SELECT * INTO STRICT v_activity_policy
    FROM hestia.environment_room_activity_policy AS policy
   WHERE policy.environment_id = p_environment_id
     AND policy.status = 'active';

  v_body_root := v_verification.body_root;
  v_room_record_root := gw_ledger.cell_ref_child(v_body_root, 0, 'room');
  SELECT * INTO v_room
    FROM hestia.agent_room AS room
   WHERE room.current_record_root = v_room_record_root
     AND room.status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room activity targets an unknown or closed room';
  END IF;

  IF v_verification.record_kind = 'room/document-attachment' THEN
    v_nested_record_root := gw_ledger.cell_ref_child(v_body_root, 1, 'document');
    v_activity_policy_root := gw_ledger.cell_ref_child(
      v_body_root, 2, 'document-policy'
    );
    v_actor_profile_record_root := gw_ledger.cell_ref_child(
      v_body_root, 3, 'attached-by'
    );
    v_activity_kind := 'document-attachment';
    v_required_purpose := 'document.attach';
    v_effect_name := 'document-attach';
    IF v_activity_policy_root <> v_activity_policy.document_policy_root THEN
      RAISE EXCEPTION 'document attachment does not bind the active document policy';
    END IF;
  ELSE
    v_outer_epoch := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_body_root, 1, 'membership-epoch')
    );
    v_actor_profile_record_root := gw_ledger.cell_ref_child(
      v_body_root, 2, 'sender-profile'
    );
    v_nested_record_root := gw_ledger.cell_ref_child(v_body_root, 3, 'envelope');
    v_payload_root := gw_ledger.cell_ref_child(v_body_root, 4, 'ciphertext');
    v_activity_policy_root := gw_ledger.cell_ref_child(
      v_body_root, 5, 'delivery-policy'
    );
    v_activity_kind := 'message-intent';
    v_required_purpose := 'room.message';
    v_effect_name := 'message-intent-commit-before-delivery';
    IF v_activity_policy_root <> v_activity_policy.message_delivery_policy_root THEN
      RAISE EXCEPTION 'message intent does not bind the active delivery policy';
    END IF;
    IF v_outer_epoch <> v_room.membership_epoch THEN
      RAISE EXCEPTION 'message intent is not bound to the current membership epoch';
    END IF;
  END IF;

  SELECT * INTO v_actor
    FROM hestia.agent_profile AS profile
   WHERE profile.current_record_root = v_actor_profile_record_root
     AND profile.status = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room activity actor profile is not current';
  END IF;
  SELECT * INTO v_member
    FROM hestia.agent_room_member AS member
   WHERE member.room_id = v_room.room_id
     AND member.member_profile_id = v_actor.profile_id
     AND member.status = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room activity actor is not an active member';
  END IF;
  IF NOT (v_required_purpose = ANY(v_member.purposes)) THEN
    RAISE EXCEPTION 'room member does not hold the required activity purpose';
  END IF;
  IF v_verification.signer_key_root <> v_actor.operational_key_root
     OR NOT hestia.agent_profile_authorized(
       v_actor.profile_id,
       v_actor.current_record_root,
       v_verification.signer_key_root,
       v_required_purpose
     ) THEN
    RAISE EXCEPTION 'room activity is not signed by an authorized operational key';
  END IF;

  IF v_verification.record_kind = 'room/document-attachment' THEN
    SELECT body_root, signer_key_root, signature_root
      INTO v_nested_body_root, v_nested_signer_key_root, v_nested_signature_root
      FROM hestia.agent_signed_record_check(
        v_nested_record_root,
        'document/version'
      );
    IF v_nested_signer_key_root <> v_verification.signer_key_root THEN
      RAISE EXCEPTION 'document version and attachment must use the same operational key';
    END IF;
    v_subject_id := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 0, 'document-id')
    );
    v_subject_sequence := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_nested_body_root, 1, 'version')
    );
    v_previous_subject_field := gw_ledger.cell_ref_child(
      v_nested_body_root, 2, 'previous-version'
    );
    v_payload_root := gw_ledger.cell_ref_child(v_nested_body_root, 3, 'content');
    v_media_type := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 4, 'media-type')
    );
    v_nested_actor_id := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 5, 'author-profile')
    );
    BEGIN
      v_occurred_at := hestia.hcv1_text(
        gw_ledger.cell_ref_child(v_nested_body_root, 6, 'created-at')
      )::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'document version has an invalid creation time';
    END;
    IF v_nested_actor_id <> v_actor.profile_id THEN
      RAISE EXCEPTION 'document author does not match the attaching profile';
    END IF;
    IF length(v_subject_id) NOT BETWEEN 1 AND 256
       OR v_subject_sequence < 1
       OR length(v_media_type) NOT BETWEEN 1 AND 256 THEN
      RAISE EXCEPTION 'document metadata is outside the admission bound';
    END IF;
    IF gw_ledger.cell_type_tag(v_payload_root) <> 11
       OR hestia.hcv1_text(hestia.hcv1_map_get(v_payload_root, 'type'))
          <> 'document/content' THEN
      RAISE EXCEPTION 'document content root is not a typed document commitment';
    END IF;
    PERFORM hestia.hcv1_map_get(v_payload_root, 'value');

    SELECT * INTO v_latest_document
      FROM hestia.agent_room_document_attachment AS attachment
     WHERE attachment.room_id = v_room.room_id
       AND attachment.document_id = v_subject_id
     ORDER BY attachment.document_version DESC
     LIMIT 1;
    IF FOUND THEN
      IF v_subject_sequence <> v_latest_document.document_version + 1
         OR v_previous_subject_field <> v_latest_document.document_record_root THEN
        RAISE EXCEPTION 'document version does not bind the latest attached version';
      END IF;
      v_previous_subject_root := v_previous_subject_field;
    ELSE
      IF v_subject_sequence <> 1
         OR NOT hestia.hcv1_is_nil(v_previous_subject_field) THEN
        RAISE EXCEPTION 'first attached document version must be sequence one';
      END IF;
      v_previous_subject_root := NULL;
    END IF;
  ELSE
    SELECT body_root, signer_key_root, signature_root
      INTO v_nested_body_root, v_nested_signer_key_root, v_nested_signature_root
      FROM hestia.agent_signed_record_check(
        v_nested_record_root,
        'room/message'
      );
    IF v_nested_signer_key_root <> v_verification.signer_key_root THEN
      RAISE EXCEPTION 'room message and intent must use the same operational key';
    END IF;
    v_subject_id := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 0, 'message-id')
    );
    v_nested_room_id := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 1, 'room')
    );
    v_nested_epoch := hestia.hcv1_bigint(
      gw_ledger.cell_ref_child(v_nested_body_root, 2, 'membership-epoch')
    );
    v_nested_actor_id := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 3, 'sender-profile')
    );
    BEGIN
      v_occurred_at := hestia.hcv1_text(
        gw_ledger.cell_ref_child(v_nested_body_root, 4, 'sent-at')
      )::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'room message has an invalid sent time';
    END;
    v_nested_iv := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 5, 'iv')
    );
    v_nested_ciphertext := hestia.hcv1_text(
      gw_ledger.cell_ref_child(v_nested_body_root, 6, 'ciphertext')
    );
    v_nested_ciphertext_root := gw_ledger.cell_ref_child(
      v_nested_body_root, 7, 'ciphertext-root'
    );
    IF length(v_subject_id) NOT BETWEEN 1 AND 256
       OR v_nested_room_id <> v_room.room_id
       OR v_nested_epoch <> v_room.membership_epoch
       OR v_nested_epoch <> v_outer_epoch
       OR v_nested_actor_id <> v_actor.profile_id THEN
      RAISE EXCEPTION 'room message scope does not match its current room membership';
    END IF;
    IF v_nested_ciphertext_root <> v_payload_root THEN
      RAISE EXCEPTION 'message intent ciphertext root does not match its envelope';
    END IF;
    IF gw_ledger.cell_type_tag(v_payload_root) <> 11
       OR hestia.hcv1_text(hestia.hcv1_map_get(v_payload_root, 'type'))
          <> 'room/ciphertext'
       OR hestia.hcv1_text(hestia.hcv1_map_get(v_payload_root, 'value'))
          <> v_nested_ciphertext THEN
      RAISE EXCEPTION 'message ciphertext commitment does not match its envelope';
    END IF;
    IF octet_length(hestia.base64url_decode(v_nested_iv)) <> 12
       OR octet_length(hestia.base64url_decode(v_nested_ciphertext)) < 16
       OR octet_length(hestia.base64url_decode(v_nested_ciphertext)) > 524288 THEN
      RAISE EXCEPTION 'room message ciphertext transport is outside the admission bound';
    END IF;
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_message_intent AS intent
       WHERE intent.room_id = v_room.room_id
         AND intent.message_id = v_subject_id
    ) THEN
      RAISE EXCEPTION 'room message intent already exists';
    END IF;
    v_subject_sequence := NULL;
    v_previous_subject_root := NULL;
    v_media_type := NULL;
  END IF;

  v_activity_sequence := v_room.activity_sequence + 1;
  IF v_activity_sequence <= v_room.activity_sequence THEN
    RAISE EXCEPTION 'room activity sequence overflow';
  END IF;
  v_previous_activity_ref := COALESCE(
    v_room.activity_head_root,
    hestia.hcv1_nil_put()
  );
  v_activity_kind_root := hestia.hcv1_string_put(v_activity_kind);
  v_epoch_root := hestia.hcv1_integer_put(v_room.membership_epoch);
  v_sequence_root := hestia.hcv1_integer_put(v_activity_sequence);
  v_activity_root := hestia.agent_record_put(
    'room/activity-state',
    ARRAY[
      v_room.current_state_root,
      v_previous_activity_ref,
      p_signed_record_root,
      v_activity_kind_root,
      v_actor.current_record_root,
      v_epoch_root,
      v_sequence_root
    ]::bytea[]
  );
  v_effect_plan_root := hestia.hcv1_string_put(v_effect_name);
  v_outcome_root := hestia.hcv1_string_put('accepted');
  v_admission_receipt_root := hestia.agent_record_put(
    'ledger/admission-receipt',
    ARRAY[
      v_previous_activity_ref,
      v_body_root,
      v_activity_policy_root,
      v_room.kernel_root,
      v_activity_root,
      v_effect_plan_root,
      p_signed_record_root,
      v_outcome_root,
      v_sequence_root
    ]::bytea[]
  );

  INSERT INTO hestia.agent_room_activity_admission (
    activity_sequence,
    signed_record_root,
    record_kind,
    body_root,
    verification_signed_receipt_root,
    room_id,
    expected_room_record_root,
    expected_room_state_root,
    expected_activity_sequence,
    expected_activity_head_root,
    actor_profile_id,
    expected_actor_profile_record_root,
    expected_actor_profile_state_root,
    actor_operational_key_root,
    actor_delegation_root,
    expected_member_state_root,
    required_purpose,
    membership_epoch,
    nested_record_root,
    nested_body_root,
    nested_signer_key_root,
    subject_id,
    subject_sequence,
    previous_subject_root,
    payload_root,
    media_type,
    occurred_at,
    activity_kind,
    activity_policy_root,
    activity_root,
    effect_plan_root,
    outcome_root,
    admission_receipt_root,
    environment_id,
    environment_key_root,
    status
  ) VALUES (
    v_activity_sequence,
    p_signed_record_root,
    v_verification.record_kind,
    v_body_root,
    v_verification.signed_receipt_root,
    v_room.room_id,
    v_room.current_record_root,
    v_room.current_state_root,
    v_room.activity_sequence,
    v_room.activity_head_root,
    v_actor.profile_id,
    v_actor.current_record_root,
    v_actor.current_state_root,
    v_actor.operational_key_root,
    v_actor.delegation_root,
    v_member.current_state_root,
    v_required_purpose,
    v_room.membership_epoch,
    v_nested_record_root,
    v_nested_body_root,
    v_nested_signer_key_root,
    v_subject_id,
    v_subject_sequence,
    v_previous_subject_root,
    v_payload_root,
    v_media_type,
    v_occurred_at,
    v_activity_kind,
    v_activity_policy_root,
    v_activity_root,
    v_effect_plan_root,
    v_outcome_root,
    v_admission_receipt_root,
    p_environment_id,
    v_environment.key_root,
    'pending-signature'
  );

  prepared_sequence := v_activity_sequence;
  prepared_activity_kind := v_activity_kind;
  prepared_room_id := v_room.room_id;
  result_activity_root := v_activity_root;
  admission_receipt_root := v_admission_receipt_root;
  receipt_signing_payload := convert_to(
    'GWAR0:ledger/admission-receipt:' || encode(v_admission_receipt_root, 'hex'),
    'UTF8'
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION hestia.agent_room_activity_commit(
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
  v_row hestia.agent_room_activity_admission%ROWTYPE;
  v_room hestia.agent_room%ROWTYPE;
  v_actor hestia.agent_profile%ROWTYPE;
  v_member hestia.agent_room_member%ROWTYPE;
  v_latest_document hestia.agent_room_document_attachment%ROWTYPE;
  v_nested_body_root bytea;
  v_nested_signer_key_root bytea;
  v_nested_signature_root bytea;
  v_signature_root bytea;
  v_signed_receipt_root bytea;
BEGIN
  SELECT * INTO v_row
    FROM hestia.agent_room_activity_admission AS admission
   WHERE admission.signed_record_root = p_signed_record_root
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room activity has not been prepared for admission';
  END IF;
  IF v_row.environment_id <> p_environment_id THEN
    RAISE EXCEPTION 'room activity was prepared for another environment';
  END IF;
  IF v_row.status = 'accepted' THEN
    RETURN v_row.admission_signed_receipt_root;
  END IF;

  SELECT * INTO v_room
    FROM hestia.agent_room AS room
   WHERE room.room_id = v_row.room_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_room.current_record_root <> v_row.expected_room_record_root
     OR v_room.current_state_root <> v_row.expected_room_state_root
     OR v_room.activity_sequence <> v_row.expected_activity_sequence
     OR v_room.activity_head_root IS DISTINCT FROM v_row.expected_activity_head_root
     OR v_room.membership_epoch <> v_row.membership_epoch
     OR v_room.status <> 'open' THEN
    RAISE EXCEPTION 'room governance or activity head changed after preparation';
  END IF;
  SELECT * INTO v_actor
    FROM hestia.agent_profile AS profile
   WHERE profile.profile_id = v_row.actor_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_actor.current_record_root <> v_row.expected_actor_profile_record_root
     OR v_actor.current_state_root <> v_row.expected_actor_profile_state_root
     OR v_actor.operational_key_root <> v_row.actor_operational_key_root
     OR v_actor.delegation_root <> v_row.actor_delegation_root
     OR v_actor.status <> 'active' THEN
    RAISE EXCEPTION 'room activity actor profile changed after preparation';
  END IF;
  SELECT * INTO v_member
    FROM hestia.agent_room_member AS member
   WHERE member.room_id = v_row.room_id
     AND member.member_profile_id = v_row.actor_profile_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_member.current_state_root <> v_row.expected_member_state_root
     OR v_member.status <> 'active'
     OR NOT (v_row.required_purpose = ANY(v_member.purposes)) THEN
    RAISE EXCEPTION 'room membership authority changed after activity preparation';
  END IF;
  IF NOT hestia.agent_profile_authorized(
    v_actor.profile_id,
    v_actor.current_record_root,
    v_actor.operational_key_root,
    v_row.required_purpose
  ) THEN
    RAISE EXCEPTION 'room activity actor no longer has delegated authority';
  END IF;

  SELECT body_root, signer_key_root, signature_root
    INTO v_nested_body_root, v_nested_signer_key_root, v_nested_signature_root
    FROM hestia.agent_signed_record_check(
      v_row.nested_record_root,
      CASE v_row.record_kind
        WHEN 'room/document-attachment' THEN 'document/version'
        ELSE 'room/message'
      END
    );
  IF v_nested_body_root <> v_row.nested_body_root
     OR v_nested_signer_key_root <> v_row.nested_signer_key_root
     OR v_nested_signer_key_root <> v_row.actor_operational_key_root THEN
    RAISE EXCEPTION 'nested room activity signature changed after preparation';
  END IF;

  IF v_row.record_kind = 'room/document-attachment' THEN
    SELECT * INTO v_latest_document
      FROM hestia.agent_room_document_attachment AS attachment
     WHERE attachment.room_id = v_row.room_id
       AND attachment.document_id = v_row.subject_id
     ORDER BY attachment.document_version DESC
     LIMIT 1;
    IF FOUND THEN
      IF v_row.subject_sequence <> v_latest_document.document_version + 1
         OR v_row.previous_subject_root <> v_latest_document.document_record_root THEN
        RAISE EXCEPTION 'document head changed after activity preparation';
      END IF;
    ELSE
      IF v_row.subject_sequence <> 1 OR v_row.previous_subject_root IS NOT NULL THEN
        RAISE EXCEPTION 'document head appeared after activity preparation';
      END IF;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM hestia.agent_room_message_intent AS intent
       WHERE intent.room_id = v_row.room_id
         AND intent.message_id = v_row.subject_id
    ) THEN
      RAISE EXCEPTION 'room message appeared after activity preparation';
    END IF;
  END IF;

  SELECT signature_root, signed_record_root
    INTO v_signature_root, v_signed_receipt_root
    FROM hestia.environment_admission_signed_record_put(
      p_environment_id,
      v_row.environment_key_root,
      v_row.admission_receipt_root,
      p_environment_signature
    );

  INSERT INTO hestia.agent_room_activity (
    room_id,
    sequence,
    activity_root,
    previous_activity_root,
    room_state_root,
    event_record_root,
    event_body_root,
    activity_kind,
    actor_profile_id,
    actor_profile_record_root,
    membership_epoch,
    activity_policy_root,
    effect_plan_root,
    admission_signed_receipt_root
  ) VALUES (
    v_row.room_id,
    v_row.activity_sequence,
    v_row.activity_root,
    v_row.expected_activity_head_root,
    v_row.expected_room_state_root,
    v_row.signed_record_root,
    v_row.body_root,
    v_row.activity_kind,
    v_row.actor_profile_id,
    v_row.expected_actor_profile_record_root,
    v_row.membership_epoch,
    v_row.activity_policy_root,
    v_row.effect_plan_root,
    v_signed_receipt_root
  );

  IF v_row.record_kind = 'room/document-attachment' THEN
    INSERT INTO hestia.agent_room_document_attachment (
      attachment_record_root,
      attachment_body_root,
      room_id,
      activity_sequence,
      activity_root,
      document_id,
      document_version,
      document_record_root,
      document_body_root,
      previous_document_root,
      content_root,
      media_type,
      author_profile_id,
      attached_by_profile_id,
      attached_by_profile_record_root,
      document_policy_root,
      admission_signed_receipt_root
    ) VALUES (
      v_row.signed_record_root,
      v_row.body_root,
      v_row.room_id,
      v_row.activity_sequence,
      v_row.activity_root,
      v_row.subject_id,
      v_row.subject_sequence,
      v_row.nested_record_root,
      v_row.nested_body_root,
      v_row.previous_subject_root,
      v_row.payload_root,
      v_row.media_type,
      v_row.actor_profile_id,
      v_row.actor_profile_id,
      v_row.expected_actor_profile_record_root,
      v_row.activity_policy_root,
      v_signed_receipt_root
    );
  ELSE
    INSERT INTO hestia.agent_room_message_intent (
      intent_record_root,
      intent_body_root,
      room_id,
      activity_sequence,
      activity_root,
      message_id,
      message_record_root,
      message_body_root,
      membership_epoch,
      sender_profile_id,
      sender_profile_record_root,
      ciphertext_root,
      delivery_policy_root,
      sent_at,
      admission_signed_receipt_root
    ) VALUES (
      v_row.signed_record_root,
      v_row.body_root,
      v_row.room_id,
      v_row.activity_sequence,
      v_row.activity_root,
      v_row.subject_id,
      v_row.nested_record_root,
      v_row.nested_body_root,
      v_row.membership_epoch,
      v_row.actor_profile_id,
      v_row.expected_actor_profile_record_root,
      v_row.payload_root,
      v_row.activity_policy_root,
      v_row.occurred_at,
      v_signed_receipt_root
    );
  END IF;

  UPDATE hestia.agent_room AS room
     SET activity_sequence = v_row.activity_sequence,
         activity_head_root = v_row.activity_root,
         updated_at = clock_timestamp()
   WHERE room.room_id = v_row.room_id;

  UPDATE hestia.agent_room_activity_admission AS admission
     SET environment_signature_root = v_signature_root,
         admission_signed_receipt_root = v_signed_receipt_root,
         status = 'accepted',
         accepted_at = clock_timestamp()
   WHERE admission.signed_record_root = p_signed_record_root;

  RETURN v_signed_receipt_root;
END;
$$;

CREATE TRIGGER agent_room_activity_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_activity
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER agent_room_document_attachment_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_document_attachment
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

CREATE TRIGGER agent_room_message_intent_no_update
BEFORE UPDATE OR DELETE ON hestia.agent_room_message_intent
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

REVOKE ALL ON hestia.environment_room_activity_policy FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_activity FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_document_attachment FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_message_intent FROM PUBLIC;
REVOKE ALL ON hestia.agent_room_activity_admission FROM PUBLIC;

REVOKE ALL ON FUNCTION hestia.environment_room_activity_policy_register(text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_activity_prepare(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION hestia.agent_room_activity_commit(text, bytea, bytea) FROM PUBLIC;

GRANT SELECT ON hestia.agent_room_activity TO hestia_app;
GRANT SELECT ON hestia.agent_room_document_attachment TO hestia_app;
GRANT SELECT ON hestia.agent_room_message_intent TO hestia_app;
GRANT SELECT ON hestia.agent_room_activity_admission TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_activity_prepare(text, bytea) TO hestia_app;
GRANT EXECUTE ON FUNCTION hestia.agent_room_activity_commit(text, bytea, bytea) TO hestia_app;

COMMENT ON TABLE hestia.agent_room_activity IS
  'Append-only room work head independent of membership governance; each root commits the governance snapshot, previous activity, event, actor, epoch and sequence.';
COMMENT ON TABLE hestia.agent_room_document_attachment IS
  'Authoritative projection of nested signed document versions attached under the current room and document policies.';
COMMENT ON TABLE hestia.agent_room_message_intent IS
  'Ciphertext-only message send intents committed before transport delivery; plaintext is never projected.';
COMMENT ON FUNCTION hestia.agent_room_activity_prepare(text, bytea) IS
  'Verifies nested document/message signatures, current membership authority, activity policy, document version or ciphertext commitments, and returns exact environment admission signing bytes.';
COMMENT ON FUNCTION hestia.agent_room_activity_commit(text, bytea, bytea) IS
  'Rechecks room governance and activity heads, verifies the environment signature, appends the activity root, updates the room activity head, and writes the document or message-intent projection atomically.';
