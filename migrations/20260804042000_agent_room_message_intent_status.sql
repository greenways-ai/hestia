ALTER TABLE hestia.agent_room_message_intent
  DROP CONSTRAINT agent_room_message_intent_delivery_status_check,
  ADD CONSTRAINT agent_room_message_intent_delivery_status_check
    CHECK (delivery_status = 'pending-delivery');

COMMENT ON COLUMN hestia.agent_room_message_intent.delivery_status IS
  'The admitted send intent is immutable and remains pending-delivery. Delivery and failure are later signed receipt events, not mutations of this row.';
