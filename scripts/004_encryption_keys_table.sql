-- Encryption Keys Table
-- Stores user encryption keys for end-to-end chat encryption
-- Each user has a Master Encryption Key (MEK) encrypted with their password-derived key

CREATE TABLE IF NOT EXISTS user_encryption_keys (
    key_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL UNIQUE,

    -- Encrypted master encryption key (MEK encrypted with password-derived key)
    encrypted_master_key TEXT NOT NULL,

    -- Salt for PBKDF2 key derivation (base64 encoded)
    key_derivation_salt VARCHAR(255) NOT NULL,

    -- Initialization vector for MEK encryption (base64 encoded)
    master_key_iv VARCHAR(255) NOT NULL,

    -- Recovery key backup (MEK encrypted with recovery key)
    encrypted_master_key_recovery TEXT NULL,
    recovery_key_iv VARCHAR(255) NULL,

    -- Version for future key rotation
    key_version INT DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
