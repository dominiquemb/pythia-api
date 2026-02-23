const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] || '';
    if (value.length > 1 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"$/g, '');
    }
    process.env[key] = value;
  });
}

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
});

const dryRun = process.argv.includes('--dry-run');

function buildTitle(message) {
  if (!message || typeof message !== 'string') return 'Migrated Chat';
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Migrated Chat';
  return normalized.length > 60 ? `${normalized.substring(0, 60)}...` : normalized;
}

async function main() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log(`Connected. dryRun=${dryRun}`);

    const pendingRows = await conn.query(
      `SELECT COUNT(*) AS total
       FROM chat_messages
       WHERE conversation_id IS NULL`
    );

    const totalPending = Number(pendingRows[0]?.total || 0);
    console.log(`Rows with NULL conversation_id: ${totalPending}`);
    if (totalPending === 0) {
      console.log('No legacy rows to migrate.');
      return;
    }

    if (!dryRun) {
      await conn.beginTransaction();
    }

    // Pass 1: group rows that still have a legacy session_key.
    const legacyGroups = await conn.query(
      `SELECT user_id, session_key,
              MIN(created_at) AS first_created_at,
              COUNT(*) AS message_count
       FROM chat_messages
       WHERE conversation_id IS NULL
         AND session_key IS NOT NULL
         AND TRIM(session_key) <> ''
       GROUP BY user_id, session_key
       ORDER BY first_created_at ASC`
    );

    console.log(`Legacy session groups found: ${legacyGroups.length}`);

    let migratedByGroup = 0;
    for (const group of legacyGroups) {
      const firstMsg = await conn.query(
        `SELECT user_message
         FROM chat_messages
         WHERE user_id = ?
           AND session_key = ?
           AND conversation_id IS NULL
         ORDER BY created_at ASC, message_id ASC
         LIMIT 1`,
        [group.user_id, group.session_key]
      );

      const title = buildTitle(firstMsg[0]?.user_message);

      if (dryRun) {
        migratedByGroup += Number(group.message_count || 0);
        continue;
      }

      const insertConversation = await conn.query(
        `INSERT INTO conversations (user_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)` ,
        [group.user_id, title, group.first_created_at, group.first_created_at]
      );

      const conversationId = insertConversation.insertId;

      const updateRows = await conn.query(
        `UPDATE chat_messages
         SET conversation_id = ?
         WHERE user_id = ?
           AND session_key = ?
           AND conversation_id IS NULL`,
        [conversationId, group.user_id, group.session_key]
      );

      migratedByGroup += Number(updateRows.affectedRows || 0);
    }

    // Pass 2: rows with empty/null session_key become one conversation per message.
    const orphanRows = await conn.query(
      `SELECT message_id, user_id, user_message, created_at
       FROM chat_messages
       WHERE conversation_id IS NULL
         AND (session_key IS NULL OR TRIM(session_key) = '')
       ORDER BY created_at ASC, message_id ASC`
    );

    console.log(`Legacy rows without session_key: ${orphanRows.length}`);

    let migratedOrphans = 0;
    for (const row of orphanRows) {
      const title = buildTitle(row.user_message);

      if (dryRun) {
        migratedOrphans += 1;
        continue;
      }

      const insertConversation = await conn.query(
        `INSERT INTO conversations (user_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [row.user_id, title, row.created_at, row.created_at]
      );

      const conversationId = insertConversation.insertId;

      const updateResult = await conn.query(
        `UPDATE chat_messages
         SET conversation_id = ?
         WHERE message_id = ?
           AND conversation_id IS NULL`,
        [conversationId, row.message_id]
      );

      migratedOrphans += Number(updateResult.affectedRows || 0);
    }

    const totalMigrated = migratedByGroup + migratedOrphans;

    if (dryRun) {
      console.log(`[dry-run] Would migrate ${totalMigrated} rows.`);
      return;
    }

    await conn.commit();

    const remainingRows = await conn.query(
      `SELECT COUNT(*) AS total
       FROM chat_messages
       WHERE conversation_id IS NULL`
    );

    console.log(`Migrated rows: ${totalMigrated}`);
    console.log(`Remaining NULL conversation_id rows: ${Number(remainingRows[0]?.total || 0)}`);
    console.log('Migration complete.');
  } catch (err) {
    if (conn && !dryRun) {
      try {
        await conn.rollback();
      } catch (_) {
        // ignore rollback failure
      }
    }
    console.error('Normalization failed:', err);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
