// ============================================================
// 数据库连接 (better-sqlite3 + Drizzle ORM)
// ============================================================

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import path from 'path';

// SQLite 数据库文件路径，默认在项目根目录下
const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'cam.db');

// 确保数据目录存在
import fs from 'fs';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);

// 开启 WAL 模式，提升并发读取性能
sqlite.pragma('journal_mode = WAL');
// 开启外键约束
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
