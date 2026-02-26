import test from 'node:test';
import assert from 'node:assert/strict';
import { getRequestClientInfo, getRequestIpAddress, getRequestUserAgent } from './request-client.ts';

test('getRequestIpAddress: 优先使用 x-forwarded-for 第一项', () => {
  const request = new Request('http://localhost', {
    headers: {
      'x-forwarded-for': '1.1.1.1, 2.2.2.2',
      'x-real-ip': '3.3.3.3',
    },
  });
  assert.equal(getRequestIpAddress(request), '1.1.1.1');
});

test('getRequestIpAddress: 无 forwarded 时回退 x-real-ip', () => {
  const request = new Request('http://localhost', {
    headers: {
      'x-real-ip': '9.9.9.9',
    },
  });
  assert.equal(getRequestIpAddress(request), '9.9.9.9');
});

test('getRequestIpAddress: 两者都缺失时返回 unknown', () => {
  const request = new Request('http://localhost');
  assert.equal(getRequestIpAddress(request), 'unknown');
});

test('getRequestUserAgent: 空白值归一化为 undefined', () => {
  const request = new Request('http://localhost', {
    headers: {
      'user-agent': '   ',
    },
  });
  assert.equal(getRequestUserAgent(request), undefined);
});

test('getRequestClientInfo: 返回统一结构', () => {
  const request = new Request('http://localhost', {
    headers: {
      'x-forwarded-for': '4.4.4.4',
      'user-agent': 'cam-test',
    },
  });
  assert.deepEqual(getRequestClientInfo(request), {
    ipAddress: '4.4.4.4',
    userAgent: 'cam-test',
  });
});
