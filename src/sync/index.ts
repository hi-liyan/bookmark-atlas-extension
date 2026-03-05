import type { SyncConfig } from '../shared/types';

export interface SyncConnectionTestResult {
  ok: boolean;
  message: string;
}

/**
 * 校验“测试连接”所需最小配置，只关注服务地址与认证信息。
 * 入参：同步配置对象。
 * 出参：错误信息数组；为空表示可进行连接测试。
 */
export const validateConnectionConfig = (config: SyncConfig): string[] => {
  const issues: string[] = [];
  const normalizedServerUrl = config.serverUrl.trim();
  const normalizedUsername = config.username.trim();
  const normalizedPassword = config.password.trim();

  if (!normalizedServerUrl) {
    issues.push('请填写 CouchDB Server URL。');
  }

  if (normalizedServerUrl && !normalizedServerUrl.startsWith('https://')) {
    issues.push('CouchDB Server URL 必须使用 HTTPS。');
  }

  // 用户名与密码必须成对填写，避免因半配置导致认证失败。
  if ((normalizedUsername && !normalizedPassword) || (!normalizedUsername && normalizedPassword)) {
    issues.push('用户名和密码需要同时填写，或同时留空。');
  }

  return issues;
};

/**
 * 校验同步配置是否满足“允许启用同步”的最小完整性要求。
 * 入参：同步配置对象。
 * 出参：错误信息数组；为空表示校验通过。
 */
export const validateSyncConfigCompleteness = (config: SyncConfig): string[] => {
  const issues = validateConnectionConfig(config);
  const normalizedDatabase = config.database.trim();

  if (!normalizedDatabase) {
    issues.push('请填写数据库名称。');
  }

  return issues;
};

/**
 * 构建 CouchDB 连接测试请求头，按需附加 Basic Auth。
 * 入参：同步配置对象。
 * 出参：请求头对象。
 */
const buildConnectionHeaders = (config: SyncConfig): HeadersInit => {
  const normalizedUsername = config.username.trim();
  const normalizedPassword = config.password.trim();
  const headers: HeadersInit = {
    Accept: 'application/json'
  };

  if (normalizedUsername && normalizedPassword) {
    const credentials = `${normalizedUsername}:${normalizedPassword}`;
    const encodedCredential =
      typeof btoa === 'function' ? btoa(credentials) : Buffer.from(credentials, 'utf-8').toString('base64');
    headers.Authorization = `Basic ${encodedCredential}`;
  }

  return headers;
};

/**
 * 对当前配置执行 CouchDB 连通性测试。
 * 入参：同步配置对象。
 * 出参：测试结果（成功/失败 + 可读消息）。
 */
export const testCouchDbConnection = async (config: SyncConfig): Promise<SyncConnectionTestResult> => {
  const issues = validateConnectionConfig(config);
  if (issues.length > 0) {
    return { ok: false, message: issues[0] };
  }

  const normalizedServerUrl = config.serverUrl.trim().replace(/\/+$/, '');
  // 连接测试仅验证服务与认证，不检查数据库是否存在。
  const url = `${normalizedServerUrl}/_session`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildConnectionHeaders(config)
    });

    if (response.ok) {
      return { ok: true, message: '连接成功，可以启用同步。' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: '连接失败：认证未通过，请检查用户名和密码。' };
    }

    return { ok: false, message: `连接失败：服务器返回状态码 ${response.status}。` };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知网络错误';
    // Firefox/Chrome 在跨域被拦截、证书异常或网络不可达时，通常只抛出笼统的 NetworkError/Failed to fetch。
    if (message.includes('NetworkError') || message.includes('Failed to fetch')) {
      return {
        ok: false,
        message:
          '连接失败：浏览器未收到服务器响应。请检查扩展是否已重载以应用 host 权限、CouchDB HTTPS 证书是否受信任、以及服务地址/端口是否可达。'
      };
    }

    return { ok: false, message: `连接失败：${message}` };
  }
};

/**
 * 校验“当前配置是否允许保存为已启用同步状态”。
 * 入参：同步配置对象。
 * 出参：错误信息数组；为空表示通过。
 */
export const validateSyncConfig = (config: SyncConfig): string[] => {
  const issues: string[] = [];

  if (config.syncEnabled) {
    issues.push(...validateSyncConfigCompleteness(config));
  }

  return issues;
};
