import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncConfig } from '../shared/types';
import {
  isValidCouchDatabaseName,
  testCouchDbConnection,
  validateConnectionConfig,
  validateSyncConfig,
  validateSyncConfigCompleteness
} from './index';

const baseConfig: SyncConfig = {
  syncEnabled: true,
  serverUrl: 'https://couchdb.example.com',
  database: 'bookmark_atlas',
  username: '',
  password: '',
  syncIntervalMin: 15,
  syncMode: 'two-way',
  conflictPolicy: 'latest-write-wins',
  autoSyncOnChange: true,
  verifySSL: true
};

// 校验项测试：验证启用同步前的配置完整性规则。
describe('validateSyncConfigCompleteness', () => {
  it('should return issues when url and database are empty', () => {
    const issues = validateSyncConfigCompleteness({
      ...baseConfig,
      serverUrl: '   ',
      database: '   '
    });

    expect(issues).toContain('请填写 CouchDB Server URL。');
    expect(issues).toContain('请填写数据库名称。');
  });

  it('should return issue when username/password is incomplete pair', () => {
    const issues = validateSyncConfigCompleteness({
      ...baseConfig,
      username: 'demo',
      password: ''
    });

    expect(issues).toContain('用户名和密码需要同时填写，或同时留空。');
  });
});

// 测试连接校验：仅检查地址与认证，不要求数据库已填写。
describe('validateConnectionConfig', () => {
  it('should ignore empty database for connection testing', () => {
    const issues = validateConnectionConfig({
      ...baseConfig,
      database: ''
    });

    expect(issues).toHaveLength(0);
  });
});

// 数据库名规则测试：确保无效名称在启用同步前被提前拦截。
describe('isValidCouchDatabaseName', () => {
  it('should return false for uppercase database name', () => {
    expect(isValidCouchDatabaseName('Bookmark_Atlas')).toBe(false);
  });

  it('should return true for legal database name', () => {
    expect(isValidCouchDatabaseName('bookmark_atlas')).toBe(true);
  });
});

// 启用状态测试：仅在 syncEnabled=true 时触发完整性校验。
describe('validateSyncConfig', () => {
  it('should ignore incompleteness when sync is disabled', () => {
    const issues = validateSyncConfig({
      ...baseConfig,
      syncEnabled: false,
      serverUrl: '',
      database: ''
    });

    expect(issues).toHaveLength(0);
  });
});

// 连通性测试：验证不同 HTTP 返回码下的提示行为。
describe('testCouchDbConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should report success when request returns 200', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal(
      'fetch',
      fetchMock
    );

    const result = await testCouchDbConnection({ ...baseConfig, database: '' });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://couchdb.example.com/_session', expect.any(Object));
  });

  it('should report auth error for 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('', { status: 401 });
      })
    );

    const result = await testCouchDbConnection(baseConfig);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('认证未通过');
  });
});
