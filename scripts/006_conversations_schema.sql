-- Conversation-first chat schema
-- Chats are stored as discrete conversations, not tied to event combinations.

CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) DEFAULT 'New Chat',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_conversations_user_id (user_id),
  INDEX idx_conversations_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS conversation_id INT NULL,
  MODIFY COLUMN session_key VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
  ON chat_messages(conversation_id);

-- Optional FK: uncomment if all existing rows have valid conversation_id values.
-- ALTER TABLE chat_messages
--   ADD CONSTRAINT fk_chat_messages_conversation
--   FOREIGN KEY (conversation_id) REFERENCES conversations(id)
--   ON DELETE CASCADE;
