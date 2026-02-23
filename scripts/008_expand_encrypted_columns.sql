-- Expand encrypted message columns to handle large payloads
-- TEXT max ~64KB; MEDIUMTEXT supports up to 16MB

ALTER TABLE chat_messages
  MODIFY COLUMN user_message_encrypted MEDIUMTEXT NULL,
  MODIFY COLUMN assistant_response_encrypted MEDIUMTEXT NULL;
