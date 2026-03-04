export type BookmarkNodeType = 'bookmark' | 'folder';

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

export type RuntimeRequest =
  | { type: 'bookmarks/get-tree' }
  | { type: 'bookmarks/get-index' }
  | { type: 'bookmarks/rebuild-index' };

export type RuntimeResponse =
  | { ok: true; tree: BookmarkNode[] }
  | { ok: true; index: BookmarkIndexSnapshot }
  | { ok: true; rebuiltAt: number }
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
