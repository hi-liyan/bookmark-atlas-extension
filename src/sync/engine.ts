import { browser } from '../shared/browser';
import { bookmarkService } from '../shared/bookmark-service';
import type {
  BookmarkNode,
  ConflictPolicy,
  SyncConfig,
  SyncExecutionResult,
  SyncMode,
  SyncRemoteSnapshot,
  SyncStatus
} from '../shared/types';
import { validateSyncConfigCompleteness } from './index';

const SYNC_CONFIG_STORAGE_KEY = 'sync-config';
const SYNC_STATUS_STORAGE_KEY = 'sync-status';
const SYNC_DOC_ID = 'bookmark-atlas::snapshot';
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 450;

interface CouchChangesRow {
  id: string;
  seq: string | number;
  deleted?: boolean;
  doc?: {
    _id?: string;
    _rev?: string;
    type?: string;
    updatedAt?: number;
    tree?: BookmarkNode[];
  };
}

interface CouchChangesResponse {
  results: CouchChangesRow[];
  last_seq: string;
}

interface CouchSnapshotDoc {
  _id: string;
  _rev?: string;
  type: 'bookmark-atlas-snapshot';
  updatedAt: number;
  tree: BookmarkNode[];
}

interface RetryableCallResult<T> {
  value: T;
  retryCount: number;
}

interface CouchErrorBody {
  error?: string;
  reason?: string;
}

/**
 * 获取默认同步状态，避免首次运行时读取到空值导致分支复杂化。
 * 入参：无。
 * 出参：默认同步状态对象。
 */
const createDefaultSyncStatus = (): SyncStatus => ({
  running: false,
  lastSyncAt: null,
  lastSuccessAt: null,
  lastError: '',
  lastSyncSeq: '0',
  lastMode: null,
  lastLocalSnapshotAt: 0,
  pushedCount: 0,
  pulledCount: 0,
  retryCount: 0
});

/**
 * 将同步配置转换为请求头，按需附加 Basic 认证。
 * 入参：同步配置。
 * 出参：可复用的 HTTP 请求头。
 */
const buildCouchHeaders = (config: SyncConfig): HeadersInit => {
  const headers: HeadersInit = {
    Accept: 'application/json'
  };
  const username = config.username.trim();
  const password = config.password.trim();

  if (username && password) {
    const raw = `${username}:${password}`;
    const token = typeof btoa === 'function' ? btoa(raw) : Buffer.from(raw, 'utf-8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  }

  return headers;
};

/**
 * 统一生成数据库 URL，避免多处拼接导致斜杠重复或缺失。
 * 入参：同步配置。
 * 出参：数据库基础 URL。
 */
const buildDatabaseUrl = (config: SyncConfig): string => {
  const server = config.serverUrl.trim().replace(/\/+$/, '');
  const database = encodeURIComponent(config.database.trim());
  return `${server}/${database}`;
};

/**
 * 指数退避重试执行器，用于网络/服务瞬时错误自动重试。
 * 入参：任务函数、最大重试次数。
 * 出参：执行结果与重试次数。
 */
const runWithRetry = async <T>(task: () => Promise<T>, maxRetries = DEFAULT_MAX_RETRIES): Promise<RetryableCallResult<T>> => {
  let attempt = 0;

  while (true) {
    try {
      const value = await task();
      return { value, retryCount: attempt };
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
};

/**
 * 从 storage 读取同步配置；缺失时抛出清晰错误信息。
 * 入参：可选配置覆盖值（用于设置页“立即同步”）。
 * 出参：有效同步配置。
 */
const getSyncConfig = async (override?: SyncConfig): Promise<SyncConfig> => {
  if (override) {
    return override;
  }

  const stored = await browser.storage.local.get(SYNC_CONFIG_STORAGE_KEY);
  const config = stored[SYNC_CONFIG_STORAGE_KEY] as SyncConfig | undefined;
  if (!config) {
    throw new Error('未找到同步配置，请先在设置页保存。');
  }
  return config;
};

/**
 * 读取当前同步状态。
 * 入参：无。
 * 出参：已存在状态或默认状态。
 */
export const getSyncStatus = async (): Promise<SyncStatus> => {
  const stored = await browser.storage.local.get(SYNC_STATUS_STORAGE_KEY);
  const status = stored[SYNC_STATUS_STORAGE_KEY] as SyncStatus | undefined;
  return status ?? createDefaultSyncStatus();
};

/**
 * 保存同步状态到 storage，确保 options 页面可直接读取状态面板。
 * 入参：同步状态对象。
 * 出参：void。
 */
const setSyncStatus = async (status: SyncStatus): Promise<void> => {
  await browser.storage.local.set({ [SYNC_STATUS_STORAGE_KEY]: status });
};

/**
 * 从 CouchDB 错误响应中提取可读错误文本。
 * 入参：HTTP 响应对象。
 * 出参：格式化错误描述。
 */
const readCouchErrorText = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as CouchErrorBody;
    if (body.error || body.reason) {
      return `${body.error || 'error'}: ${body.reason || 'unknown reason'}`;
    }
  } catch {
    // 非 JSON 错误体时走状态码兜底。
  }

  return `状态码 ${response.status}`;
};

/**
 * 确保远端数据库存在：不存在时自动创建，支持首次启用场景。
 * 入参：同步配置。
 * 出参：本步骤产生的重试次数。
 */
const ensureDatabaseExists = async (config: SyncConfig): Promise<number> => {
  const dbUrl = buildDatabaseUrl(config);
  const headers = buildCouchHeaders(config);

  const getResult = await runWithRetry(async () => {
    const response = await fetch(dbUrl, { method: 'GET', headers });
    if (response.status === 404) {
      return response;
    }
    if (!response.ok) {
      const errorText = await readCouchErrorText(response);
      throw new Error(`连接数据库失败（${errorText}）。`);
    }
    return response;
  });

  if (getResult.value.status !== 404) {
    return getResult.retryCount;
  }

  const createResult = await runWithRetry(async () => {
    const response = await fetch(dbUrl, { method: 'PUT', headers });
    if (response.status === 201 || response.status === 202 || response.status === 412) {
      return response;
    }
    const errorText = await readCouchErrorText(response);
    if (response.status === 400 && errorText.includes('illegal_database_name')) {
      throw new Error('创建数据库失败：数据库名称不合法，请使用小写字母开头，且仅包含小写字母、数字和 _$()+/-。');
    }
    throw new Error(`创建数据库失败（${errorText}）。`);
  });

  return getResult.retryCount + createResult.retryCount;
};

/**
 * 构建本地书签快照文档，用于上传到 CouchDB。
 * 入参：无。
 * 出参：快照文档与本地更新时间戳。
 */
const buildLocalSnapshotDoc = async (): Promise<CouchSnapshotDoc> => {
  const tree = await bookmarkService.getTree();
  const updatedAt = Date.now();

  return {
    _id: SYNC_DOC_ID,
    type: 'bookmark-atlas-snapshot',
    updatedAt,
    tree
  };
};

/**
 * 获取远端快照文档（若不存在返回 null）。
 * 入参：同步配置。
 * 出参：远端文档或 null，以及重试次数。
 */
const getRemoteSnapshotDoc = async (config: SyncConfig): Promise<RetryableCallResult<CouchSnapshotDoc | null>> => {
  const dbUrl = buildDatabaseUrl(config);
  const docUrl = `${dbUrl}/${encodeURIComponent(SYNC_DOC_ID)}`;
  const headers = buildCouchHeaders(config);

  return runWithRetry(async () => {
    const response = await fetch(docUrl, { method: 'GET', headers });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`读取远端快照失败（状态码 ${response.status}）。`);
    }
    const body = (await response.json()) as CouchSnapshotDoc;
    if (body.type !== 'bookmark-atlas-snapshot' || !Array.isArray(body.tree)) {
      throw new Error('远端快照文档格式不合法。');
    }
    return body;
  });
};

/**
 * 推送本地快照到远端文档，若已存在则携带 _rev 覆盖写入。
 * 入参：同步配置。
 * 出参：推送数量、本地快照时间、重试次数。
 */
const pushSnapshot = async (config: SyncConfig): Promise<{ pushedCount: number; localSnapshotAt: number; retryCount: number }> => {
  const dbUrl = buildDatabaseUrl(config);
  const docUrl = `${dbUrl}/${encodeURIComponent(SYNC_DOC_ID)}`;
  const headers = buildCouchHeaders(config);
  const localDoc = await buildLocalSnapshotDoc();

  const remoteDocResult = await getRemoteSnapshotDoc(config);
  if (remoteDocResult.value?._rev) {
    localDoc._rev = remoteDocResult.value._rev;
  }

  const putResult = await runWithRetry(async () => {
    const response = await fetch(docUrl, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(localDoc)
    });

    if (!response.ok) {
      throw new Error(`上传快照失败（状态码 ${response.status}）。`);
    }
    return response;
  });

  return {
    pushedCount: 1,
    localSnapshotAt: localDoc.updatedAt,
    retryCount: remoteDocResult.retryCount + putResult.retryCount
  };
};

/**
 * 读取增量变更流，返回本轮变化与最新序列号。
 * 入参：同步配置、起始序列号。
 * 出参：changes 响应以及重试次数。
 */
const fetchChanges = async (config: SyncConfig, since: string): Promise<RetryableCallResult<CouchChangesResponse>> => {
  const dbUrl = buildDatabaseUrl(config);
  const headers = buildCouchHeaders(config);
  const changesUrl = `${dbUrl}/_changes?since=${encodeURIComponent(since)}&include_docs=true`;

  return runWithRetry(async () => {
    const response = await fetch(changesUrl, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`读取 _changes 失败（状态码 ${response.status}）。`);
    }
    return (await response.json()) as CouchChangesResponse;
  });
};

/**
 * 根据冲突策略判断是否应用远端快照。
 * 入参：冲突策略、远端快照时间、本地快照时间。
 * 出参：是否应用远端。
 */
export const shouldApplyRemoteSnapshot = (
  policy: ConflictPolicy,
  remoteUpdatedAt: number,
  localUpdatedAt: number
): boolean => {
  if (policy === 'prefer-remote') {
    return true;
  }

  if (policy === 'prefer-local') {
    return localUpdatedAt === 0;
  }

  return remoteUpdatedAt > localUpdatedAt;
};

/**
 * 递归复制远端节点到指定父目录，保留标题/URL 层级结构。
 * 入参：父目录 ID、远端节点列表。
 * 出参：void。
 */
const cloneChildrenToFolder = async (parentId: string, nodes: BookmarkNode[]): Promise<void> => {
  for (const node of nodes) {
    if (node.type === 'folder') {
      const created = await bookmarkService.create({
        parentId,
        title: node.title,
        type: 'folder'
      });
      await cloneChildrenToFolder(created.id, node.children ?? []);
      continue;
    }

    if (node.type === 'bookmark' && node.url) {
      await bookmarkService.create({
        parentId,
        title: node.title,
        url: node.url,
        type: 'bookmark'
      });
    }
  }
};

/**
 * 清空目录现有子节点，为远端快照回放做准备。
 * 入参：目录 ID。
 * 出参：void。
 */
const clearFolderChildren = async (folderId: string): Promise<void> => {
  const subTree = await browser.bookmarks.getSubTree(folderId);
  const folder = subTree[0];
  const children = folder.children ?? [];

  for (const child of children) {
    if (child.type === 'folder' || child.children?.length) {
      await browser.bookmarks.removeTree(child.id);
      continue;
    }
    await browser.bookmarks.remove(child.id);
  }
};

/**
 * 将远端快照应用到本地书签：按顶层目录逐个清空并回放其子树。
 * 入参：远端快照。
 * 出参：void。
 */
const applyRemoteSnapshotToLocal = async (snapshot: SyncRemoteSnapshot): Promise<void> => {
  const currentTree = await browser.bookmarks.getTree();
  const currentRoot = currentTree[0];
  const remoteRoot = snapshot.tree[0];

  if (!currentRoot || !remoteRoot) {
    throw new Error('本地或远端书签树为空，无法应用快照。');
  }

  const currentTopFolders = (currentRoot.children ?? []).filter((node) => node.type === 'folder');
  const remoteTopFolders = (remoteRoot.children ?? []).filter((node) => node.type === 'folder');

  for (let index = 0; index < currentTopFolders.length; index += 1) {
    const currentFolder = currentTopFolders[index];
    // 先按标题匹配顶层目录，标题不一致时降级按索引匹配，兼容不同浏览器根目录 ID 差异。
    const matchedByTitle = remoteTopFolders.find((folder) => folder.title === currentFolder.title);
    const remoteFolder = matchedByTitle ?? remoteTopFolders[index];
    if (!remoteFolder) {
      continue;
    }

    await clearFolderChildren(currentFolder.id);
    await cloneChildrenToFolder(currentFolder.id, remoteFolder.children ?? []);
  }
};

/**
 * 拉取远端变更并按冲突策略决定是否应用到本地。
 * 入参：同步配置、本地同步状态。
 * 出参：拉取数量、最新序列号、本地快照时间、重试次数。
 */
const pullSnapshot = async (
  config: SyncConfig,
  status: SyncStatus
): Promise<{ pulledCount: number; lastSyncSeq: string; localSnapshotAt: number; retryCount: number }> => {
  const changeResult = await fetchChanges(config, status.lastSyncSeq);
  const changes = changeResult.value;
  let localSnapshotAt = status.lastLocalSnapshotAt;
  let pulledCount = 0;

  const snapshotRows = changes.results.filter((row) => row.id === SYNC_DOC_ID && !row.deleted && row.doc);
  const latestRow = snapshotRows[snapshotRows.length - 1];

  if (latestRow?.doc?.updatedAt && Array.isArray(latestRow.doc.tree)) {
    const remoteUpdatedAt = latestRow.doc.updatedAt;
    const shouldApply = shouldApplyRemoteSnapshot(config.conflictPolicy, remoteUpdatedAt, status.lastLocalSnapshotAt);

    if (shouldApply) {
      await applyRemoteSnapshotToLocal({
        updatedAt: remoteUpdatedAt,
        tree: latestRow.doc.tree
      });
      localSnapshotAt = remoteUpdatedAt;
      pulledCount = 1;
    }
  }

  return {
    pulledCount,
    lastSyncSeq: String(changes.last_seq),
    localSnapshotAt,
    retryCount: changeResult.retryCount
  };
};

/**
 * 执行一次同步流程，覆盖 two-way / push-only / pull-only 与冲突策略。
 * 入参：可选配置覆盖值（通常来自 options 当前草稿）。
 * 出参：同步执行结果。
 */
export const runSyncNow = async (override?: SyncConfig): Promise<SyncExecutionResult> => {
  const config = await getSyncConfig(override);
  const issues = validateSyncConfigCompleteness(config);
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }
  if (!config.syncEnabled) {
    throw new Error('同步开关未开启，无法执行立即同步。');
  }

  const startedAt = Date.now();
  const previous = await getSyncStatus();
  const runningStatus: SyncStatus = {
    ...previous,
    running: true,
    lastSyncAt: startedAt,
    lastError: '',
    lastMode: config.syncMode
  };
  await setSyncStatus(runningStatus);

  try {
    let retryCount = await ensureDatabaseExists(config);
    let pushedCount = 0;
    let pulledCount = 0;
    let localSnapshotAt = runningStatus.lastLocalSnapshotAt;
    let lastSyncSeq = runningStatus.lastSyncSeq;

    if (config.syncMode === 'two-way' || config.syncMode === 'push-only') {
      const push = await pushSnapshot(config);
      pushedCount += push.pushedCount;
      localSnapshotAt = push.localSnapshotAt;
      retryCount += push.retryCount;
    }

    if (config.syncMode === 'two-way' || config.syncMode === 'pull-only') {
      const pull = await pullSnapshot(config, {
        ...runningStatus,
        lastLocalSnapshotAt: localSnapshotAt,
        lastSyncSeq
      });
      pulledCount += pull.pulledCount;
      localSnapshotAt = pull.localSnapshotAt;
      lastSyncSeq = pull.lastSyncSeq;
      retryCount += pull.retryCount;
    }

    const finishedAt = Date.now();
    await setSyncStatus({
      ...runningStatus,
      running: false,
      lastSuccessAt: finishedAt,
      lastError: '',
      lastSyncSeq,
      lastLocalSnapshotAt: localSnapshotAt,
      pushedCount,
      pulledCount,
      retryCount
    });

    return {
      startedAt,
      finishedAt,
      mode: config.syncMode,
      pushedCount,
      pulledCount,
      retryCount,
      lastSyncSeq,
      message: '同步完成。'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步失败';
    await setSyncStatus({
      ...runningStatus,
      running: false,
      lastError: message
    });
    throw new Error(message);
  }
};
