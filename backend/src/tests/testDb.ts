import { newDb, IMemoryDb, DataType } from 'pg-mem';
import { v4 as uuidv4 } from 'uuid';
import { setPool } from '../db/pool.js';
import pg from 'pg';

let memoryDb: IMemoryDb | null = null;

export function setupTestDatabase(): pg.Pool {
  const db = newDb({
    autoCreateForeignKeyIndices: true
  });

  // Register uuid functions
  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    implementation: () => uuidv4()
  });

  db.public.registerFunction({
    name: 'current_timestamp',
    returns: DataType.timestamp,
    implementation: () => new Date()
  });

  // Synchronous custom functions
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: string) => (s ? s.toLowerCase() : s)
  });

  db.public.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: string) => (s ? s.trim() : s)
  });

  // Create mock pool from pg-mem adapter
  const adapter = db.adapters.createPg();
  const mockPool = new adapter.Pool() as unknown as pg.Pool;
  (mockPool as any).__isPgMem = true;

  setPool(mockPool);
  memoryDb = db;

  return mockPool;
}

export function getMemoryDb(): IMemoryDb | null {
  return memoryDb;
}
