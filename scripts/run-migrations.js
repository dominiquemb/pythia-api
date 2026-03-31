#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mariadb = require('mariadb');

const MIGRATIONS_TABLE = 'schema_migrations';

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'pythia',
    multipleStatements: true
  };
}

function getMigrationFiles(rootDir) {
  return fs
    .readdirSync(rootDir)
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .sort();
}

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function ensureMigrationsTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum VARCHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function getAppliedMigrations(conn) {
  const rows = await conn.query(`SELECT filename, checksum FROM ${MIGRATIONS_TABLE}`);
  const map = new Map();
  for (const row of rows) {
    map.set(row.filename, row.checksum);
  }
  return map;
}

function resolveBaselineVersion(rawBaseline, migrationFiles) {
  if (!rawBaseline) {
    return '';
  }

  if (rawBaseline === 'latest') {
    return migrationFiles[migrationFiles.length - 1].slice(0, 3);
  }

  if (!/^\d{3}$/.test(rawBaseline)) {
    throw new Error(`Invalid baseline value: ${rawBaseline}`);
  }

  return rawBaseline;
}

async function run() {
  loadEnvFile();
  const rootDir = process.cwd();
  const migrationFiles = getMigrationFiles(rootDir);
  const args = process.argv.slice(2);
  const baselineIndex = args.indexOf('--baseline');
  const rawBaseline = baselineIndex >= 0 ? args[baselineIndex + 1] || 'latest' : '';
  const reportAppliedCount = args.includes('--report-applied-count');
  const baselineVersion = resolveBaselineVersion(rawBaseline, migrationFiles);

  if (migrationFiles.length === 0) {
    console.log('No migration files found.');
    if (reportAppliedCount) {
      console.log('APPLIED_MIGRATIONS_COUNT=0');
    }
    return;
  }

  const conn = await mariadb.createConnection(getDbConfig());

  try {
    await ensureMigrationsTable(conn);
    const applied = await getAppliedMigrations(conn);

    let appliedCount = 0;
    let skippedCount = 0;
    let baselinedCount = 0;

    if (baselineVersion) {
      for (const file of migrationFiles) {
        const version = file.slice(0, 3);
        if (version > baselineVersion) {
          continue;
        }

        const filePath = path.join(rootDir, file);
        const sql = fs.readFileSync(filePath, 'utf8').trim();
        const fileChecksum = checksum(sql);

        if (applied.has(file)) {
          if (applied.get(file) !== fileChecksum) {
            throw new Error(`Checksum mismatch for already applied migration: ${file}`);
          }
          skippedCount += 1;
          console.log(`Already tracked: ${file}`);
          continue;
        }

        await conn.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES (?, ?)`,
          [file, fileChecksum]
        );
        baselinedCount += 1;
        console.log(`Baselined: ${file}`);
      }

      console.log(`Baseline complete. Added: ${baselinedCount}, Skipped: ${skippedCount}`);
      if (reportAppliedCount) {
        console.log('APPLIED_MIGRATIONS_COUNT=0');
      }
      return;
    }

    for (const file of migrationFiles) {
      const filePath = path.join(rootDir, file);
      const sql = fs.readFileSync(filePath, 'utf8').trim();
      const fileChecksum = checksum(sql);

      if (!sql) {
        skippedCount += 1;
        console.log(`Skipping empty migration: ${file}`);
        continue;
      }

      if (applied.has(file)) {
        if (applied.get(file) !== fileChecksum) {
          throw new Error(`Checksum mismatch for already applied migration: ${file}`);
        }
        skippedCount += 1;
        console.log(`Already applied: ${file}`);
        continue;
      }

      console.log(`Applying: ${file}`);
      await conn.beginTransaction();
      try {
        await conn.query(sql);
        await conn.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES (?, ?)`,
          [file, fileChecksum]
        );
        await conn.commit();
        appliedCount += 1;
        console.log(`Applied: ${file}`);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    console.log(`Migration run complete. Applied: ${appliedCount}, Skipped: ${skippedCount}`);
    if (reportAppliedCount) {
      console.log(`APPLIED_MIGRATIONS_COUNT=${appliedCount}`);
    }
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
