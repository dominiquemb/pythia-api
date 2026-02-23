-- Add Encryption Columns to chat_messages Table
-- Allows gradual migration from plaintext to encrypted messages
-- is_encrypted flag determines which fields to read

ALTER TABLE chat_messages
ADD COLUMN user_message_encrypted TEXT NULL AFTER user_message,
ADD COLUMN assistant_response_encrypted TEXT NULL AFTER assistant_response,
ADD COLUMN encryption_iv_user VARCHAR(255) NULL,
ADD COLUMN encryption_iv_assistant VARCHAR(255) NULL,
ADD COLUMN is_encrypted BOOLEAN DEFAULT FALSE;
