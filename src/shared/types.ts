export type BookmarkNodeType = 'bookmark' | 'folder' | 'separator';

export interface BookmarkNode {
  id: string;
  parentId?: string;
  type: BookmarkNodeType;
  title: string;
  url?: string;
  index?: number;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
}

export interface BookmarkIndexItem {
  id: string;
  title: string;
  titleNorm: string;
  url?: string;
  urlNorm: string;
  parentId?: string;
  path: string[];
}

export interface BookmarkIndexSnapshot {
  version: number;
  updatedAt: number;
  items: BookmarkIndexItem[];
}

export interface SyncRemoteSnapshot {
  updatedAt: number;
  tree: BookmarkNode[];
}

export interface SyncStatus {
  running: boolean;
  lastSyncAt: number | null;
  lastSuccessAt: number | null;
  lastError: string;
  lastSyncSeq: string;
  lastMode: SyncMode | null;
  lastLocalSnapshotAt: number;
  pushedCount: number;
  pulledCount: number;
  retryCount: number;
}

export interface SyncExecutionResult {
  startedAt: number;
  finishedAt: number;
  mode: SyncMode;
  pushedCount: number;
  pulledCount: number;
  retryCount: number;
  lastSyncSeq: string;
  message: string;
}

export type RuntimeRequest =
  | { type: 'bookmarks/get-tree' }
  | { type: 'bookmarks/get-index' }
  | { type: 'bookmarks/rebuild-index' }
  | { type: 'bookmarks/move'; bookmarkId: string; parentId: string }
  | { type: 'bookmarks/move-folder'; folderId: string; parentId: string }
  | { type: 'bookmarks/create-folder'; parentId: string; title: string }
  | { type: 'bookmarks/create-bookmark'; parentId: string; title: string; url: string }
  | { type: 'bookmarks/delete-folder'; folderId: string }
  | { type: 'bookmarks/rename-folder'; folderId: string; title: string }
  | { type: 'bookmarks/update'; bookmarkId: string; title: string; url: string }
  | { type: 'bookmarks/delete'; bookmarkId: string }
  | { type: 'sync/get-status' }
  | { type: 'sync/run-now'; config?: SyncConfig };

export type RuntimeResponse =
  | { ok: true; tree: BookmarkNode[] }
  | { ok: true; index: BookmarkIndexSnapshot }
  | { ok: true; rebuiltAt: number }
  | { ok: true; movedId: string }
  | { ok: true; movedFolderId: string }
  | { ok: true; created: BookmarkNode }
  | { ok: true; deletedFolderId: string }
  | { ok: true; renamedFolderId: string }
  | { ok: true; updatedId: string }
  | { ok: true; deletedId: string }
  | { ok: true; syncStatus: SyncStatus }
  | { ok: true; syncResult: SyncExecutionResult }
  | { ok: false; error: string };

export type SyncMode = 'two-way' | 'push-only' | 'pull-only';
export type ConflictPolicy = 'latest-write-wins' | 'prefer-local' | 'prefer-remote';

export interface SyncConfig {
  syncEnabled: boolean;
  serverUrl: string;
  database: string;
  username: string;
  password: string;
  syncIntervalMin: number;
  syncMode: SyncMode;
  conflictPolicy: ConflictPolicy;
  autoSyncOnChange: boolean;
  verifySSL: boolean;
}
