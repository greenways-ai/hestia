ALTER TABLE hestia.agent_room_activity_admission
  DROP CONSTRAINT agent_room_activity_admission_pkey,
  DROP CONSTRAINT agent_room_activity_admission_signed_record_root_key,
  ADD PRIMARY KEY (signed_record_root),
  ADD CONSTRAINT agent_room_activity_admission_room_sequence_key
    UNIQUE (room_id, activity_sequence),
  ADD CONSTRAINT agent_room_activity_admission_room_fk
    FOREIGN KEY (room_id) REFERENCES hestia.agent_room(room_id);

CREATE TRIGGER environment_room_activity_policy_no_update
BEFORE UPDATE OR DELETE ON hestia.environment_room_activity_policy
FOR EACH ROW EXECUTE FUNCTION hestia.reject_event_mutation();

COMMENT ON CONSTRAINT agent_room_activity_admission_room_sequence_key
  ON hestia.agent_room_activity_admission IS
  'At most one prepared event may claim the next activity position for a room; signed record roots remain the global staging identity.';
