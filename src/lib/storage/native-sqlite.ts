import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';

const DEFAULT_DB_VERSION = 1;
const connections = new Map<string, Promise<SQLiteDBConnection>>();

let sqlite: SQLiteConnection | null = null;
let pluginUnavailable = false;

function isPluginUnavailableError(error: unknown) {
  const message = String(error).toLowerCase();
  return (
    message.includes('capacitorsqliteplugin') ||
    message.includes('plugin') && message.includes('null') ||
    message.includes('not implemented') ||
    message.includes('not available')
  );
}

export function isNativeSQLitePluginAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CapacitorSQLite') && !pluginUnavailable;
}

function getSQLite() {
  sqlite = sqlite || new SQLiteConnection(CapacitorSQLite);
  return sqlite;
}

function isAlreadyOpenError(error: unknown) {
  return String(error).toLowerCase().includes('already open');
}

function isAlreadyExistsError(error: unknown) {
  return String(error).toLowerCase().includes('already exists');
}

async function createOrRetrieveConnection(dbName: string) {
  const sqliteConnection = getSQLite();
  const sqliteAny = sqliteConnection as any;

  try {
    const hasConnection = await sqliteAny.isConnection?.(dbName, false);
    if (hasConnection?.result) {
      return sqliteAny.retrieveConnection(dbName, false) as Promise<SQLiteDBConnection>;
    }
  } catch (error) {
    console.warn(`[AMYC SQLite] Connection lookup failed for ${dbName}:`, error);
  }

  try {
    return await sqliteConnection.createConnection(
      dbName,
      false,
      'no-encryption',
      DEFAULT_DB_VERSION,
      false
    );
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return sqliteAny.retrieveConnection(dbName, false) as Promise<SQLiteDBConnection>;
    }
    throw error;
  }
}

async function openConnection(db: SQLiteDBConnection) {
  try {
    await db.open();
  } catch (error) {
    if (!isAlreadyOpenError(error)) {
      throw error;
    }
  }
  return db;
}

export async function getNativeSQLiteDb(dbName: string) {
  if (!isNativeSQLitePluginAvailable()) return null;

  const existing = connections.get(dbName);
  if (existing) return existing;

  const connectionPromise = createOrRetrieveConnection(dbName).then(openConnection);
  connections.set(dbName, connectionPromise);

  try {
    return await connectionPromise;
  } catch (error) {
    connections.delete(dbName);
    if (isPluginUnavailableError(error)) {
      pluginUnavailable = true;
      console.warn('[AMYC SQLite] Native SQLite plugin unavailable; continuing with Dexie storage.', error);
      return null;
    }
    throw error;
  }
}

export async function getSQLiteTableColumns(db: SQLiteDBConnection, tableName: string) {
  const result = await db.query(`PRAGMA table_info(${tableName})`);
  return new Set((result.values || []).map((row) => String(row.name)));
}

export async function addSQLiteColumnIfMissing(
  db: SQLiteDBConnection,
  tableName: string,
  columnName: string,
  definition: string
) {
  const columns = await getSQLiteTableColumns(db, tableName);
  if (columns.has(columnName)) return;
  await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
