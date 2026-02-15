// ============================================================
// 种子数据: 内置 Agent 定义
// 使用方式: pnpm db:seed
// ============================================================

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { agentDefinitions } from './schema';
import { BUILTIN_AGENTS } from './builtin-agents';
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

  console.log('[Seed] 插入内置 Agent 定义...');

  for (const agent of BUILTIN_AGENTS) {
    db.insert(agentDefinitions)
      .values(agent)
      .onConflictDoNothing({ target: agentDefinitions.id })
      .run();
    console.log(`[Seed]   - ${agent.displayName} (${agent.id})`);
  }

  console.log('[Seed] 种子数据插入完成');
  sqlite.close();
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('[Seed] 失败:', err);
  process.exit(1);
}
