import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Schema migrations, applied in order. PRAGMA user_version tracks the last applied one.
const MIGRATIONS: string[] = [
  `CREATE TABLE records (
     tbl       TEXT    NOT NULL,
     id        TEXT    NOT NULL,
     data      TEXT    NOT NULL,
     updatedAt INTEGER NOT NULL,
     deleted   INTEGER NOT NULL DEFAULT 0,
     version   INTEGER NOT NULL,
     PRIMARY KEY (tbl, id)
   );
   CREATE INDEX records_version ON records(version);`,
];

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
