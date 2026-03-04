import { useEffect, useMemo, useState } from 'react';
import type { BookmarkIndexItem } from '../shared/types';
import { usePopupStore } from './store';
import {
  buildFolderTree,
  filterBookmarks,
  flattenFolderTree,
  ROOT_FOLDER_ID,
  type FolderViewNode
} from './view-model';

interface FolderTreeProps {
  nodes: FolderViewNode[];
  selectedFolderId: string;
  dropTargetFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onDragOverFolder: (folderId: string) => void;
  onDragLeaveFolder: () => void;
  onDropToFolder: (folderId: string) => void;
}

/**
 * 渲染目录树节点，支持点击选中与拖拽放置高亮。
 */
const FolderTree = ({
  nodes,
  selectedFolderId,
  dropTargetFolderId,
  onSelectFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropToFolder
}: FolderTreeProps) => (
  <ul className="space-y-1">
    {nodes.map((node) => {
      const selected = node.id === selectedFolderId;
      const dropTarget = node.id === dropTargetFolderId;

      return (
        <li key={node.id}>
          {/* 目录节点：点击切换右侧列表内容，拖拽时可作为放置目标 */}
          <button
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
              selected
                ? 'bg-emerald-100 text-emerald-900 shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            } ${dropTarget ? 'ring-2 ring-emerald-300' : ''}`}
            onClick={() => onSelectFolder(node.id)}
            onDragOver={(event) => {
              event.preventDefault();
              onDragOverFolder(node.id);
            }}
            onDragLeave={() => onDragLeaveFolder()}
            onDrop={(event) => {
              event.preventDefault();
              onDropToFolder(node.id);
            }}
            type="button"
          >
            <span aria-hidden className="text-emerald-600">
              ▸
            </span>
            <span className="truncate">{node.title}</span>
          </button>
          {node.children.length > 0 ? (
            <div className="ml-4 border-l border-slate-200 pl-2">
              <FolderTree
                nodes={node.children}
                selectedFolderId={selectedFolderId}
                dropTargetFolderId={dropTargetFolderId}
                onSelectFolder={onSelectFolder}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
                onDropToFolder={onDropToFolder}
              />
            </div>
          ) : null}
        </li>
      );
    })}
  </ul>
);

/**
 * 右侧书签列表：按卡片展示，支持拖拽用于目录移动。
 */
const BookmarkCards = ({
  items,
  draggingBookmarkId,
  onStartDragging
}: {
  items: BookmarkIndexItem[];
  draggingBookmarkId: string | null;
  onStartDragging: (bookmarkId: string) => void;
}) => (
  <div className="min-h-0 space-y-2 overflow-auto pr-1">
    {items.map((item) => (
      <article
        key={item.id}
        className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition ${
          draggingBookmarkId === item.id ? 'opacity-60' : ''
        }`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/bookmark-id', item.id);
          event.dataTransfer.effectAllowed = 'move';
          onStartDragging(item.id);
        }}
      >
        {/* 书签主信息区域：标题 + URL */}
        <h3 className="mb-1 line-clamp-1 text-sm font-semibold text-slate-800">
          {item.title || '未命名书签'}
        </h3>
        <p className="mb-2 line-clamp-1 text-xs text-slate-500">{item.url ?? '-'}</p>
        {/* 路径提示区域：用于帮助识别当前书签来源目录 */}
        <p className="text-xs text-slate-400">{item.path.join(' / ') || '根目录'}</p>
      </article>
    ))}
  </div>
);

/**
 * Popup 主界面：负责目录选择、书签筛选与拖拽移动交互。
 */
export const PopupApp = () => {
  const {
    tree,
    items,
    query,
    selectedFolderId,
    loading,
    moving,
    error,
    setQuery,
    setSelectedFolderId,
    load,
    moveBookmark
  } = usePopupStore();
  const [draggingBookmarkId, setDraggingBookmarkId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const folderTree = useMemo(() => buildFolderTree(tree), [tree]);
  const folderMap = useMemo(() => flattenFolderTree(folderTree), [folderTree]);

  const filteredItems = useMemo(() => {
    return filterBookmarks(items, selectedFolderId, query);
  }, [items, selectedFolderId, query]);

  useEffect(() => {
    if (selectedFolderId === ROOT_FOLDER_ID) {
      return;
    }

    if (!folderMap.has(selectedFolderId)) {
      // 当目录被外部删除时，自动回退到根目录，避免右侧空白状态不明确。
      setSelectedFolderId(ROOT_FOLDER_ID);
    }
  }, [folderMap, selectedFolderId, setSelectedFolderId]);

  const selectedFolderTitle =
    selectedFolderId === ROOT_FOLDER_ID
      ? '根目录（未归档）'
      : folderMap.get(selectedFolderId)?.title ?? '未知目录';

  return (
    <div className="flex h-full flex-col bg-gradient-to-br from-slate-100 via-emerald-50 to-cyan-50 p-4 text-slate-800">
      {/* 顶栏区域：标题、状态与刷新入口 */}
      <header className="mb-3 rounded-2xl border border-white/60 bg-white/80 p-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-wide">Bookmark Atlas</h1>
            <p className="text-xs text-slate-500">左侧目录，右侧内容，支持拖拽移动</p>
          </div>
          <button
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
            onClick={() => void load()}
            type="button"
          >
            刷新
          </button>
        </div>
        {/* 搜索区域：在当前目录范围内搜索标题和 URL */}
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="text-slate-400">⌕</span>
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="在当前目录搜索标题或 URL"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>

      {loading ? <div className="mb-3 rounded-lg bg-cyan-100 px-3 py-2 text-sm text-cyan-800">正在加载书签...</div> : null}
      {moving ? <div className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">正在移动书签...</div> : null}
      {error ? <div className="mb-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-3">
        {/* 左侧目录区域：展示层级目录并接收拖拽放置 */}
        <aside className="min-h-0 overflow-auto rounded-2xl border border-white/60 bg-white/90 p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">目录</h2>
          <button
            className={`mb-2 w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${
              selectedFolderId === ROOT_FOLDER_ID
                ? 'bg-emerald-100 text-emerald-900 shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => setSelectedFolderId(ROOT_FOLDER_ID)}
            type="button"
          >
            根目录（未归档）
          </button>
          <FolderTree
            nodes={folderTree}
            selectedFolderId={selectedFolderId}
            dropTargetFolderId={dropTargetFolderId}
            onSelectFolder={setSelectedFolderId}
            onDragOverFolder={(folderId) => setDropTargetFolderId(folderId)}
            onDragLeaveFolder={() => setDropTargetFolderId(null)}
            onDropToFolder={(folderId) => {
              if (!draggingBookmarkId) {
                return;
              }
              setDropTargetFolderId(null);
              void moveBookmark(draggingBookmarkId, folderId);
              setDraggingBookmarkId(null);
            }}
          />
        </aside>

        {/* 右侧内容区域：展示当前目录的书签列表 */}
        <section className="flex min-h-0 flex-col rounded-2xl border border-white/60 bg-white/90 p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">{selectedFolderTitle}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {filteredItems.length} 条
            </span>
          </div>
          {filteredItems.length > 0 ? (
            <div
              onDragEnd={() => {
                setDraggingBookmarkId(null);
                setDropTargetFolderId(null);
              }}
              className="min-h-0"
            >
              <BookmarkCards
                items={filteredItems}
                draggingBookmarkId={draggingBookmarkId}
                onStartDragging={setDraggingBookmarkId}
              />
            </div>
          ) : (
            <div className="flex min-h-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
              当前目录没有匹配书签
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
