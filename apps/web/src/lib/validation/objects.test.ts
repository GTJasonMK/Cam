import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOwnKey, isPlainObject } from './objects.ts';

test('isPlainObject: 普通对象返回 true', () => {
  assert.equal(isPlainObject({ a: 1 }), true);
});

test('isPlainObject: null/数组/原始值返回 false', () => {
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject('x'), false);
  assert.equal(isPlainObject(1), false);
});

test('hasOwnKey: 仅判断对象自身键', () => {
  const base = { inherited: 1 };
  const derived = Object.create(base) as { own?: string };
  derived.own = 'value';

  assert.equal(hasOwnKey(derived, 'own'), true);
  assert.equal(hasOwnKey(derived, 'inherited'), false);
});
