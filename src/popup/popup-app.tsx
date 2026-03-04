import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { browser } from '../shared/browser';
import type { BookmarkIndexItem } from '../shared/types';
import { usePopupStore } from './store';
import { loadPopupViewState, savePopupViewState } from './view-state-storage';
import { sanitizePopupViewStateSnapshot } from './view-state';
import {
  buildFolderTree,
  collectAllFolderIds,
  collectFolderSubtreeIds,
  filterBookmarks,
  flattenFolderTree,
  ROOT_FOLDER_ID,
  type FolderViewNode
} from './view-model';

interface FolderTreeProps {
  nodes: FolderViewNode[];
  selectedFolderId: string;
  expandedFolderIds: Set<string>;
  dropTargetFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onToggleExpand: (folderId: string) => void;
  onDragOverFolder: (folderId: string) => void;
  onDragLeaveFolder: () => void;
  onDropToFolder: (folderId: string) => void;
  registerFolderElement: (folderId: string, element: HTMLButtonElement | null) => void;
}

interface BookmarkContextMenuState {
  x: number;
  y: number;
  item: BookmarkIndexItem;
}

interface EditBookmarkDraft {
  id: string;
  title: string;
  url: string;
}

/**
 * 渲染目录树节点，支持点击选中与拖拽放置高亮。
 */
const FolderTree = ({
  nodes,
  selectedFolderId,
  expandedFolderIds,
  dropTargetFolderId,
  onSelectFolder,
  onToggleExpand,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropToFolder,
  registerFolderElement
}: FolderTreeProps) => (
  <ul className="space-y-1">
    {nodes.map((node) => {
      const selected = node.id === selectedFolderId;
      const dropTarget = node.id === dropTargetFolderId;
      const hasChildren = node.children.length > 0;
      const expanded = expandedFolderIds.has(node.id);

      return (
        <li key={node.id}>
          {/* 目录节点行：图标控制展开，名称负责切换右侧内容 */}
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button
                className="inline-flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 transition hover:bg-slate-100"
                onClick={() => onToggleExpand(node.id)}
                type="button"
              >
                {expanded ? '▾' : '▸'}
              </button>
            ) : (
              // 最后一级目录不展示展开图标，用占位保持对齐。
              <span aria-hidden className="inline-block h-6 w-6" />
            )}
            <button
              ref={(element) => registerFolderElement(node.id, element)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-left text-sm transition ${
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
              <span className="truncate">{node.title}</span>
            </button>
          </div>
          {hasChildren && expanded ? (
            <div className="ml-4 border-l border-slate-200 pl-2">
              <FolderTree
                nodes={node.children}
                selectedFolderId={selectedFolderId}
                expandedFolderIds={expandedFolderIds}
                dropTargetFolderId={dropTargetFolderId}
                onSelectFolder={onSelectFolder}
                onToggleExpand={onToggleExpand}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
                onDropToFolder={onDropToFolder}
                registerFolderElement={registerFolderElement}
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
  isSearchMode,
  onStartDragging,
  onOpenBookmarkFolder,
  onOpenContextMenu
}: {
  items: BookmarkIndexItem[];
  draggingBookmarkId: string | null;
  isSearchMode: boolean;
  onStartDragging: (bookmarkId: string) => void;
  onOpenBookmarkFolder: (item: BookmarkIndexItem) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, item: BookmarkIndexItem) => void;
}) => (
  <div className="h-full space-y-2 overflow-y-auto pr-1">
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
        onClick={() => {
          // 仅在搜索结果模式下点击卡片时，定位到左侧对应目录。
          if (isSearchMode) {
            onOpenBookmarkFolder(item);
          }
        }}
        onContextMenu={(event) => onOpenContextMenu(event, item)}
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
    moveBookmark,
    updateBookmark,
    deleteBookmark
  } = usePopupStore();
  const [draggingBookmarkId, setDraggingBookmarkId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set<string>());
  const [contextMenu, setContextMenu] = useState<BookmarkContextMenuState | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditBookmarkDraft | null>(null);
  const [deletingItem, setDeletingItem] = useState<BookmarkIndexItem | null>(null);
  const [editFormError, setEditFormError] = useState('');
  const folderElementMapRef = useRef<Map<string, HTMLButtonElement>>(new Map<string, HTMLButtonElement>());
  const pendingScrollFolderIdRef = useRef<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const hasStoredViewStateRef = useRef(false);
  const hasInitializedExpandStateRef = useRef(false);
  const [viewStateHydrated, setViewStateHydrated] = useState(false);
  const isSearchMode = query.trim().length > 0;

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 初始化时恢复 popup 视图状态，保证重新打开后保留上次筛选与目录展开状态。
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedState = await loadPopupViewState();
      if (cancelled) {
        return;
      }

      hasStoredViewStateRef.current = Boolean(storedState);
      if (storedState) {
        setQuery(storedState.query);
        setSelectedFolderId(storedState.selectedFolderId);
        setExpandedFolderIds(new Set<string>(storedState.expandedFolderIds));
      }

      setViewStateHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [setQuery, setSelectedFolderId]);

  const folderTree = useMemo(() => buildFolderTree(tree), [tree]);
  const allFolderIds = useMemo(() => collectAllFolderIds(folderTree), [folderTree]);
  const folderMap = useMemo(() => flattenFolderTree(folderTree), [folderTree]);
  const selectedFolderSubtreeIds = useMemo(
    () =>
      selectedFolderId === ROOT_FOLDER_ID ? null : collectFolderSubtreeIds(folderTree, selectedFolderId),
    [folderTree, selectedFolderId]
  );
  const allExpanded = allFolderIds.length > 0 && allFolderIds.every((folderId) => expandedFolderIds.has(folderId));

  useEffect(() => {
    if (!viewStateHydrated) {
      return;
    }

    const validFolderIds = new Set<string>(allFolderIds);
    setExpandedFolderIds((previous) => {
      const cleanedExpandedFolderIds = new Set<string>(
        Array.from(previous).filter((folderId) => validFolderIds.has(folderId))
      );

      // 首次初始化时，无历史状态才默认展开全部；之后仅清理失效目录，避免覆盖用户操作。
      if (!hasInitializedExpandStateRef.current) {
        hasInitializedExpandStateRef.current = true;
        if (!hasStoredViewStateRef.current) {
          return new Set<string>(allFolderIds);
        }
      }

      return cleanedExpandedFolderIds;
    });
  }, [allFolderIds, viewStateHydrated]);

  /**
   * 在目录节点渲染完成后执行滚动定位，确保用户能看到目标目录。
   */
  useEffect(() => {
    const pendingFolderId = pendingScrollFolderIdRef.current;
    if (!pendingFolderId) {
      return;
    }

    const folderElement = folderElementMapRef.current.get(pendingFolderId);
    if (!folderElement) {
      return;
    }

    folderElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pendingScrollFolderIdRef.current = null;
  }, [expandedFolderIds, selectedFolderId, folderTree]);

  /**
   * 统一处理右键菜单关闭：点击外部区域或按下 ESC 都会关闭。
   */
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      if (!contextMenuRef.current) {
        return;
      }
      if (!contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const filteredItems = useMemo(() => {
    return filterBookmarks(items, selectedFolderId, selectedFolderSubtreeIds, query);
  }, [items, selectedFolderId, selectedFolderSubtreeIds, query]);

  useEffect(() => {
    if (selectedFolderId === ROOT_FOLDER_ID) {
      return;
    }

    if (!folderMap.has(selectedFolderId)) {
      // 当目录被外部删除时，自动回退到根目录，避免右侧空白状态不明确。
      setSelectedFolderId(ROOT_FOLDER_ID);
    }
  }, [folderMap, selectedFolderId, setSelectedFolderId]);

  /**
   * 监听 popup 关键视图状态变化并持久化，供下次打开时恢复。
   */
  useEffect(() => {
    if (!viewStateHydrated) {
      return;
    }

    const validFolderIds = new Set<string>(allFolderIds);
    const snapshot = sanitizePopupViewStateSnapshot(
      {
        query,
        selectedFolderId,
        expandedFolderIds: Array.from(expandedFolderIds)
      },
      validFolderIds
    );
    void savePopupViewState(snapshot);
  }, [allFolderIds, expandedFolderIds, query, selectedFolderId, viewStateHydrated]);

  const selectedFolderTitle =
    isSearchMode
      ? '结果'
      : selectedFolderId === ROOT_FOLDER_ID
        ? '根目录（未归档）'
        : folderMap.get(selectedFolderId)?.title ?? '未知目录';

  /**
   * 搜索结果点击定位：选中书签所属目录并展开其父级路径。
   */
  const locateBookmarkFolder = (item: BookmarkIndexItem): void => {
    const targetFolderId = item.parentId ?? ROOT_FOLDER_ID;
    if (targetFolderId === ROOT_FOLDER_ID) {
      setSelectedFolderId(ROOT_FOLDER_ID);
      pendingScrollFolderIdRef.current = ROOT_FOLDER_ID;
      return;
    }

    const expandedPathIds: string[] = [];
    let cursorId: string | undefined = targetFolderId;

    // 逐级回溯父目录，确保左侧树可见并展开到目标节点。
    while (cursorId) {
      expandedPathIds.push(cursorId);
      cursorId = folderMap.get(cursorId)?.parentId;
    }

    setExpandedFolderIds((previous) => {
      const next = new Set<string>(previous);
      expandedPathIds.forEach((folderId) => next.add(folderId));
      return next;
    });
    setSelectedFolderId(targetFolderId);
    // 记录待滚动目录，待左侧树展开并渲染后自动定位。
    pendingScrollFolderIdRef.current = targetFolderId;
  };

  /**
   * 打开右键菜单，并根据视口尺寸修正坐标避免菜单溢出。
   */
  const openContextMenu = (event: ReactMouseEvent<HTMLElement>, item: BookmarkIndexItem): void => {
    event.preventDefault();
    const MENU_WIDTH = 190;
    const MENU_HEIGHT = 196;
    const EDGE_PADDING = 8;

    const x = Math.max(
      EDGE_PADDING,
      Math.min(event.clientX, window.innerWidth - MENU_WIDTH - EDGE_PADDING)
    );
    const y = Math.max(
      EDGE_PADDING,
      Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - EDGE_PADDING)
    );

    setContextMenu({ x, y, item });
  };

  /**
   * 在新标签页打开书签 URL。
   */
  const openInNewTab = async (item: BookmarkIndexItem): Promise<void> => {
    if (!item.url) {
      return;
    }
    await browser.tabs.create({ url: item.url });
  };

  /**
   * 在当前激活标签页打开书签 URL；无可用标签时回退为新建标签页。
   */
  const openInCurrentTab = async (item: BookmarkIndexItem): Promise<void> => {
    if (!item.url) {
      return;
    }

    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id !== undefined) {
      await browser.tabs.update(activeTab.id, { url: item.url });
      return;
    }
    await browser.tabs.create({ url: item.url });
  };

  /**
   * 提交编辑书签表单并刷新列表。
   */
  const submitEditBookmark = async (): Promise<void> => {
    if (!editingDraft) {
      return;
    }

    const title = editingDraft.title.trim();
    const url = editingDraft.url.trim();
    if (!url) {
      setEditFormError('URL 不能为空');
      return;
    }

    setEditFormError('');
    await updateBookmark(editingDraft.id, title, url);
    setEditingDraft(null);
    setContextMenu(null);
  };

  /**
   * 执行删除书签，删除前通过独立确认弹窗进行二次确认。
   */
  const confirmDeleteBookmark = async (): Promise<void> => {
    if (!deletingItem) {
      return;
    }
    await deleteBookmark(deletingItem.id);
    setDeletingItem(null);
    setContextMenu(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gradient-to-br from-slate-100 via-emerald-50 to-cyan-50 p-4 text-slate-800">
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
        {/* 搜索区域：始终在全局范围搜索标题和 URL */}
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="text-slate-400">⌕</span>
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="全局搜索标题或 URL"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>

      {loading ? <div className="mb-3 rounded-lg bg-cyan-100 px-3 py-2 text-sm text-cyan-800">正在加载书签...</div> : null}
      {moving ? <div className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">正在移动书签...</div> : null}
      {error ? <div className="mb-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-3 overflow-hidden">
        {/* 左侧目录区域：展示层级目录并接收拖拽放置 */}
        <aside className="flex min-h-0 flex-col rounded-2xl border border-white/60 bg-white/90 p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">目录</h2>
            <button
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-200"
              onClick={() => {
                setExpandedFolderIds(allExpanded ? new Set<string>() : new Set<string>(allFolderIds));
              }}
              type="button"
            >
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          </div>
          <button
            ref={(element) => {
              if (element) {
                folderElementMapRef.current.set(ROOT_FOLDER_ID, element);
              } else {
                folderElementMapRef.current.delete(ROOT_FOLDER_ID);
              }
            }}
            className={`mb-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
              selectedFolderId === ROOT_FOLDER_ID
                ? 'bg-emerald-100 text-emerald-900 shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => setSelectedFolderId(ROOT_FOLDER_ID)}
            type="button"
          >
            根目录（未归档）
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <FolderTree
              nodes={folderTree}
              selectedFolderId={selectedFolderId}
              expandedFolderIds={expandedFolderIds}
              dropTargetFolderId={dropTargetFolderId}
              onSelectFolder={setSelectedFolderId}
              onToggleExpand={(folderId) => {
                setExpandedFolderIds((previous) => {
                  const next = new Set<string>(previous);
                  // 根据当前状态切换目录展开集合。
                  if (next.has(folderId)) {
                    next.delete(folderId);
                  } else {
                    next.add(folderId);
                  }
                  return next;
                });
              }}
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
              registerFolderElement={(folderId, element) => {
                if (element) {
                  folderElementMapRef.current.set(folderId, element);
                } else {
                  folderElementMapRef.current.delete(folderId);
                }
              }}
            />
          </div>
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
              className="min-h-0 flex-1 overflow-hidden"
            >
              <BookmarkCards
                items={filteredItems}
                draggingBookmarkId={draggingBookmarkId}
                isSearchMode={isSearchMode}
                onStartDragging={setDraggingBookmarkId}
                onOpenBookmarkFolder={locateBookmarkFolder}
                onOpenContextMenu={openContextMenu}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
              当前目录没有匹配书签
            </div>
          )}
        </section>
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-50 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* 右键菜单：书签快捷操作入口 */}
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => {
              void openInNewTab(contextMenu.item);
              setContextMenu(null);
            }}
            type="button"
          >
            在新标签页中打开
          </button>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => {
              void openInCurrentTab(contextMenu.item);
              setContextMenu(null);
            }}
            type="button"
          >
            在当前标签页中打开
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => {
              setEditingDraft({
                id: contextMenu.item.id,
                title: contextMenu.item.title,
                url: contextMenu.item.url ?? ''
              });
              setEditFormError('');
              setContextMenu(null);
            }}
            type="button"
          >
            编辑书签
          </button>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
            onClick={() => {
              setDeletingItem(contextMenu.item);
              setContextMenu(null);
            }}
            type="button"
          >
            删除书签
          </button>
        </div>
      ) : null}

      {editingDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          {/* 编辑弹窗：修改标题和 URL */}
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">编辑书签</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">标题</label>
            <input
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={editingDraft.title}
              onChange={(event) =>
                setEditingDraft((previous) =>
                  previous ? { ...previous, title: event.target.value } : previous
                )
              }
              type="text"
            />
            <label className="mb-2 block text-xs font-medium text-slate-600">URL</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={editingDraft.url}
              onChange={(event) =>
                setEditingDraft((previous) =>
                  previous ? { ...previous, url: event.target.value } : previous
                )
              }
              type="url"
            />
            {editFormError ? <p className="mt-2 text-xs text-rose-600">{editFormError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
                onClick={() => setEditingDraft(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700"
                onClick={() => void submitEditBookmark()}
                type="button"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deletingItem ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          {/* 删除确认弹窗：满足删除操作二次确认要求 */}
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-slate-800">删除书签</h3>
            <p className="mb-4 text-sm text-slate-600">
              确认删除“{deletingItem.title || '未命名书签'}”？该操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
                onClick={() => setDeletingItem(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm text-white transition hover:bg-rose-500"
                onClick={() => void confirmDeleteBookmark()}
                type="button"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
