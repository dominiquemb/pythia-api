-- Chat Messages Table
-- Stores conversation history grouped by session keys (event selections)

CREATE TABLE IF NOT EXISTS chat_messages (
    message_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    session_key VARCHAR(255) NOT NULL,
    user_message TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    event_ids_used JSON NOT NULL,
    query_metadata JSON DEFAULT NULL,
    is_saved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_session (user_id, session_key),
    INDEX idx_created_at (created_at),
    INDEX idx_is_saved (is_saved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
