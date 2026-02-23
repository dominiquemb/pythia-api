# Chat Encryption + Conversation Migration Runbook

This runbook applies the database changes required for:
1. End-to-end encrypted chat storage
2. Conversation-based chats (discrete threads, not event-linked session keys)

## Files
- `scripts/004_encryption_keys_table.sql`
- `scripts/005_add_encryption_columns.sql`
- `scripts/008_expand_encrypted_columns.sql`
- `scripts/006_conversations_schema.sql`
- `scripts/007_normalize_legacy_chat_conversations.js`

## Apply Order
Run in this exact order:

```bash
mysql -u <db_user> -p <db_name> < scripts/004_encryption_keys_table.sql
mysql -u <db_user> -p <db_name> < scripts/005_add_encryption_columns.sql
mysql -u <db_user> -p <db_name> < scripts/008_expand_encrypted_columns.sql
mysql -u <db_user> -p <db_name> < scripts/006_conversations_schema.sql
```

Then normalize legacy rows that still have `conversation_id IS NULL`:

```bash
# Optional preview
node scripts/007_normalize_legacy_chat_conversations.js --dry-run

# Apply
node scripts/007_normalize_legacy_chat_conversations.js
```

## What Each Migration Does

### `004_encryption_keys_table.sql`
Creates `user_encryption_keys` for per-user encrypted key material:
- `encrypted_master_key`
- `key_derivation_salt`
- `master_key_iv`
- recovery key backup fields

### `005_add_encryption_columns.sql`
Adds encrypted message support to `chat_messages`:
- `user_message_encrypted`
- `assistant_response_encrypted`
- `encryption_iv_user`
- `encryption_iv_assistant`
- `is_encrypted`

### `008_expand_encrypted_columns.sql`
Expands encrypted message columns to handle large payloads:
- `user_message_encrypted` (to `MEDIUMTEXT`)
- `assistant_response_encrypted` (to `MEDIUMTEXT`)

### `006_conversations_schema.sql`
Moves chats to conversation-first model:
- creates `conversations`
- adds `conversation_id` to `chat_messages`
- makes legacy `session_key` nullable
- adds index on `chat_messages(conversation_id)`

## Verification Queries
Run after migrations:

```sql
DESCRIBE user_encryption_keys;
DESCRIBE chat_messages;
DESCRIBE conversations;
SHOW INDEX FROM chat_messages;
SHOW INDEX FROM conversations;
```

Expected key results:
- `chat_messages.conversation_id` exists
- `chat_messages.session_key` is nullable
- `chat_messages` includes encryption fields from migration 005
- `conversations` table exists with indexes

## Optional Data Backfill (Legacy Rows)
If old `chat_messages` rows exist without `conversation_id`, `scripts/007_normalize_legacy_chat_conversations.js` performs the backfill:
- groups legacy rows by `(user_id, session_key)` when `session_key` exists
- creates one conversation per legacy group
- handles orphan rows with null/empty `session_key` by creating one conversation per message
- updates `chat_messages.conversation_id` in a transaction (unless `--dry-run`)

## Optional FK Hardening (After Backfill)
In `scripts/006_conversations_schema.sql`, uncomment and run FK block once all rows have valid `conversation_id`:

```sql
ALTER TABLE chat_messages
  ADD CONSTRAINT fk_chat_messages_conversation
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  ON DELETE CASCADE;
```

## Rollback Notes
No automatic rollback scripts are included.
To rollback safely:
1. Take DB backup before applying migrations.
2. If needed, manually drop added columns/tables in reverse dependency order.

## Backend Endpoint Expectations After Migration
- Conversation-based history:
  - `GET /api/chat/:userId/conversation/:conversationId`
  - `DELETE /api/chat-conversation/:userId/:conversationId`
- Session list now represents conversation threads:
  - `GET /api/chat-sessions/:userId`
- Encrypted save route supports conversation threads:
  - `POST /api/chat/save-encrypted`
