import test from 'node:test';
import assert from 'node:assert/strict';
import { isSqliteForeignKeyConstraintError, isSqliteMissingSchemaError } from './sqlite-errors.ts';

test('isSqliteMissingSchemaError: no such table/column 返回 true', () => {
  assert.equal(
    isSqliteMissingSchemaError(new Error('SqliteError: no such table: task_templates')),
    true,
  );
  assert.equal(
    isSqliteMissingSchemaError(new Error('SqliteError: no such column: terminal_session_pool.mode')),
    true,
  );
});

test('isSqliteMissingSchemaError: 命中 hints 返回 true', () => {
  assert.equal(
    isSqliteMissingSchemaError(new Error('sqlite error: missing terminal_session_pool'), ['terminal_session_pool']),
    true,
  );
});

test('isSqliteMissingSchemaError: 非缺表场景返回 false', () => {
  assert.equal(
    isSqliteMissingSchemaError(new Error('FOREIGN KEY constraint failed'), ['terminal_session_pool']),
    false,
  );
});

test('isSqliteForeignKeyConstraintError: code 或 message 命中都返回 true', () => {
  assert.equal(isSqliteForeignKeyConstraintError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }), true);
  assert.equal(isSqliteForeignKeyConstraintError(new Error('FOREIGN KEY constraint failed')), true);
});

test('isSqliteForeignKeyConstraintError: 非 FK 约束错误返回 false', () => {
  assert.equal(isSqliteForeignKeyConstraintError(new Error('no such table: tasks')), false);
  assert.equal(isSqliteForeignKeyConstraintError({ code: 'SQLITE_BUSY' }), false);
});
