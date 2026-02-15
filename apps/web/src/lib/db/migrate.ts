// ============================================================
// 数据库迁移脚本
// 使用方式: pnpm db:migrate
// ============================================================

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function main() {
  const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'cam.db');

  // 确保数据目录存在
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite);

  console.log('[Migrate] 开始执行数据库迁移...');
  console.log('[Migrate] 数据库路径:', dbPath);
  migrate(db, { migrationsFolder: './drizzle' });
  console.log('[Migrate] 迁移完成');

  sqlite.close();
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('[Migrate] 迁移失败:', err);
  process.exit(1);
}
