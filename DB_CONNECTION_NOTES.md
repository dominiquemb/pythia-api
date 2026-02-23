# Database Connection Notes (Non-Sensitive)

These notes describe how I connected to the local MariaDB instance from this repo to run migrations. Do **not** add credentials here.

## Environment
- Repo: `.` (current working directory)
- DB creds are sourced from `.env`

## What Worked
The socket exists at:
- `/run/mysqld/mysqld.sock`

Connect using the system `mariadb` client (outside the sandbox), via the socket:

```bash
mariadb -u <db_user> -p<db_password> -S /run/mysqld/mysqld.sock <db_name>
```

Then run a migration file:

```bash
mariadb -u <db_user> -p<db_password> -S /run/mysqld/mysqld.sock <db_name> < scripts/008_expand_encrypted_columns.sql
```

## If Socket Connection Fails
Quick checks (non-sensitive):

```bash
ls -l /run/mysqld/mysqld.sock
ps aux | rg -n "mariad|mysqld"
```

If MariaDB is running and the socket exists but the sandbox client still fails, use the system `mariadb` client outside the sandbox.
