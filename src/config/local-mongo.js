import path from 'node:path';
import fs from 'node:fs';

export const LOCAL_DATA_DIR = path.resolve(process.cwd(), '.mongo-data');

/** Lock files mongod leaves behind if it is killed rather than shut down. */
const LOCK_FILES = ['mongod.lock', 'WiredTiger.lock'];

/**
 * Removes stale lock files so a hard-killed mongod does not permanently wedge
 * the local database.
 *
 * On Windows an open file cannot be deleted, so a successful unlink is itself
 * proof that no live process holds the lock — if a mongod really is still
 * running against this directory, the delete throws and we leave it alone.
 */
function clearStaleLocks() {
  const cleared = [];
  for (const name of LOCK_FILES) {
    const file = path.join(LOCAL_DATA_DIR, name);
    if (!fs.existsSync(file)) continue;
    try {
      fs.unlinkSync(file);
      cleared.push(name);
    } catch {
      return null; // genuinely in use
    }
  }
  return cleared;
}

const isLockError = (error) => /DBPathInUse|lock file/i.test(error?.message ?? '');

/**
 * Boots an embedded MongoDB so the API runs without a local install or an
 * Atlas cluster. The engine is downloaded and cached on first use, and data
 * is persisted to ./.mongo-data so it survives restarts.
 *
 * `mongodb-memory-server` is a devDependency, so it is imported lazily — a
 * production deployment never reaches this path and never needs the package.
 */
export async function startLocalMongo() {
  const { MongoMemoryServer } = await import('mongodb-memory-server');

  fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });

  const create = (persistent) =>
    MongoMemoryServer.create({
      instance: persistent
        ? { dbName: 'renderways', dbPath: LOCAL_DATA_DIR, storageEngine: 'wiredTiger' }
        : { dbName: 'renderways' },
    });

  let mongo;
  let persisted = true;

  try {
    mongo = await create(true);
  } catch (error) {
    if (!isLockError(error)) throw error;

    const cleared = clearStaleLocks();
    if (cleared?.length) {
      console.warn(`🔧  Cleared stale lock file(s): ${cleared.join(', ')} — retrying...`);
    }

    try {
      mongo = await create(true);
    } catch (retryError) {
      if (!isLockError(retryError)) throw retryError;

      // Another mongod still owns ./.mongo-data — most often an orphan left
      // behind by a previous run. Rather than killing someone else's process,
      // start a throwaway instance so the API still comes up.
      console.warn(`
⚠️   ./.mongo-data is locked by another MongoDB process.

    Starting a TEMPORARY in-memory database instead — the API will work
    normally, but data will not persist when you stop the server.

    To get persistence back, close any other running API process (or
    end "mongod-x64-*.exe" in Task Manager) and restart.
`);
      mongo = await create(false);
      persisted = false;
    }
  }

  return {
    uri: mongo.getUri('renderways'),
    persisted,
    stop: () => mongo.stop(),
  };
}
