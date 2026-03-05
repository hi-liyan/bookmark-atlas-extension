
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { browser } from '../shared/browser';
import { normalizeText } from '../shared/normalize';
import type { BookmarkIndexItem } from '../shared/types';
import { BookmarkFavicon } from './bookmark-favicon';
import { usePopupStore } from './store';
import { sanitizePopupViewStateSnapshot } from './view-state';
import { loadPopupViewState, savePopupViewState } from './view-state-storage';
import {
  buildFolderTree,
  collectAllFolderIds,
  flattenFolderTree,
  ROOT_FOLDER_ID,
  type FolderViewNode
} from './view-model';

interface BookmarkTreeProps {
  nodes: FolderViewNode[];
  selectedFolderId: string;
  expandedFolderIds: Set<string>;
  folderBookmarkMap: Map<string, BookmarkIndexItem[]>;
  visibleFolderIds: Set<string> | null;
  dropTargetFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onToggleExpand: (folderId: string) => void;
  onDragOverFolder: (folderId: string) => void;
  onDragLeaveFolder: () => void;
  onDropToFolder: (folderId: string) => void;
  onOpenFolderMenu: (event: ReactMouseEvent<HTMLElement>, folderId: string, title: string) => void;
  onOpenBookmarkMenu: (event: ReactMouseEvent<HTMLElement>, item: BookmarkIndexItem) => void;
  onDragBookmarkStart: (bookmarkId: string) => void;
  onDragBookmarkEnd: () => void;
  registerFolderElement: (folderId: string, element: HTMLButtonElement | null) => void;
}

type PopupContextMenuState =
  | {
      kind: 'bookmark';
      x: number;
      y: number;
      item: BookmarkIndexItem;
    }
  | {
      kind: 'folder';
      x: number;
      y: number;
      folderId: string;
      title: string;
      canDelete: boolean;
      createParentId: string | null;
    };

interface EditBookmarkDraft {
  id: string;
  title: string;
  url: string;
}

interface CreateFolderDraft {
  parentId: string;
  title: string;
}

interface CreateBookmarkDraft {
  parentId: string;
  title: string;
  url: string;
}

interface DeleteFolderDraft {
  id: string;
  title: string;
}

/**
 * 目录图标：用于在目录名称前提供统一视觉标识。
 * 入参：无。
 * 出参：目录 SVG 图标。
 */
const FolderIcon = () => {
  return (
    <svg
      aria-hidden
      className="h-4 w-4 shrink-0 text-amber-500"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.293a1 1 0 0 1 .707.293l1.207 1.207H18.5A2.5 2.5 0 0 1 21 9v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
};

/**
 * 渲染单条书签行，支持右键和拖拽移动。
 * 入参：书签项与交互回调。
 * 出参：书签 JSX 节点。
 */
const BookmarkRow = ({
  item,
  onOpenBookmarkMenu,
  onDragBookmarkStart,
  onDragBookmarkEnd
}: {
  item: BookmarkIndexItem;
  onOpenBookmarkMenu: (event: ReactMouseEvent<HTMLElement>, targetItem: BookmarkIndexItem) => void;
  onDragBookmarkStart: (bookmarkId: string) => void;
  onDragBookmarkEnd: () => void;
}) => {
  return (
    <article
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/bookmark-id', item.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragBookmarkStart(item.id);
      }}
      onDragEnd={onDragBookmarkEnd}
      onContextMenu={(event) => onOpenBookmarkMenu(event, item)}
    >
      {/* 书签主体：左侧 favicon，右侧标题与 URL。 */}
      <div className="flex items-start gap-2">
        {/* 站点图标：优先显示 favicon，失败时回退首字母。 */}
        <BookmarkFavicon url={item.url} title={item.title} sizeClassName="mt-0.5 h-4 w-4" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-xs font-medium text-slate-800">{item.title || '未命名书签'}</p>
          <p className="line-clamp-1 text-[11px] text-slate-500">{item.url ?? '-'}</p>
        </div>
      </div>
    </article>
  );
};

/**
 * 渲染“目录下直接展示书签”的递归树。
 * 入参：目录节点、目录对应书签映射与交互回调。
 * 出参：目录书签树 JSX。
 */
const BookmarkTree = ({
  nodes,
  selectedFolderId,
  expandedFolderIds,
  folderBookmarkMap,
  visibleFolderIds,
  dropTargetFolderId,
  onSelectFolder,
  onToggleExpand,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropToFolder,
  onOpenFolderMenu,
  onOpenBookmarkMenu,
  onDragBookmarkStart,
  onDragBookmarkEnd,
  registerFolderElement
}: BookmarkTreeProps) => {
  return (
    <ul className="space-y-1.5">
      {nodes.map((node) => {
        if (visibleFolderIds && !visibleFolderIds.has(node.id)) {
          return null;
        }

        const folderBookmarks = folderBookmarkMap.get(node.id) ?? [];
        const visibleChildren = visibleFolderIds
          ? node.children.filter((child) => visibleFolderIds.has(child.id))
          : node.children;
        const expandable = folderBookmarks.length > 0 || visibleChildren.length > 0;
        const expanded = expandedFolderIds.has(node.id);
        const selected = node.id === selectedFolderId;
        const dropTarget = node.id === dropTargetFolderId;

        return (
          <li key={node.id}>
            {/* 目录行：目录后直接展示该目录书签。 */}
            <div className="flex items-center gap-1">
              {expandable ? (
                <button
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 transition hover:bg-slate-100"
                  onClick={() => onToggleExpand(node.id)}
                  type="button"
                >
                  {expanded ? '▼' : '▶'}
                </button>
              ) : (
                <span aria-hidden className="inline-block h-6 w-6" />
              )}
              <button
                ref={(element) => registerFolderElement(node.id, element)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                  selected ? 'bg-emerald-100 text-emerald-900 shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                } ${dropTarget ? 'ring-2 ring-emerald-300' : ''}`}
                onClick={() => onSelectFolder(node.id)}
                onContextMenu={(event) => onOpenFolderMenu(event, node.id, node.title)}
                onDragOver={(event) => {
                  event.preventDefault();
                  onDragOverFolder(node.id);
                }}
                onDragLeave={onDragLeaveFolder}
                onDrop={(event) => {
                  event.preventDefault();
                  onDropToFolder(node.id);
                }}
                type="button"
              >
                {/* 目录图标：明确当前行为目录节点。 */}
                <div className="inline-flex items-center gap-1.5">
                  <FolderIcon />
                  <span className="truncate">{node.title}</span>
                </div>
              </button>
            </div>

            {expanded ? (
              <div className="ml-6 mt-1 space-y-1">
                {folderBookmarks.map((item) => (
                  <BookmarkRow
                    key={item.id}
                    item={item}
                    onOpenBookmarkMenu={onOpenBookmarkMenu}
                    onDragBookmarkStart={onDragBookmarkStart}
                    onDragBookmarkEnd={onDragBookmarkEnd}
                  />
                ))}

                {visibleChildren.length > 0 ? (
                  <BookmarkTree
                    nodes={visibleChildren}
                    selectedFolderId={selectedFolderId}
                    expandedFolderIds={expandedFolderIds}
                    folderBookmarkMap={folderBookmarkMap}
                    visibleFolderIds={visibleFolderIds}
                    dropTargetFolderId={dropTargetFolderId}
                    onSelectFolder={onSelectFolder}
                    onToggleExpand={onToggleExpand}
                    onDragOverFolder={onDragOverFolder}
                    onDragLeaveFolder={onDragLeaveFolder}
                    onDropToFolder={onDropToFolder}
                    onOpenFolderMenu={onOpenFolderMenu}
                    onOpenBookmarkMenu={onOpenBookmarkMenu}
                    onDragBookmarkStart={onDragBookmarkStart}
                    onDragBookmarkEnd={onDragBookmarkEnd}
                    registerFolderElement={registerFolderElement}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

/**
 * 打开扩展设置页。
 */
const openOptionsPage = async (): Promise<void> => {
  await browser.runtime.openOptionsPage();
};

/**
 * 限制菜单坐标，防止弹层超出 popup 视口。
 */
const clampMenuPosition = (
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } => {
  const EDGE_PADDING = 8;
  return {
    x: Math.max(EDGE_PADDING, Math.min(x, window.innerWidth - width - EDGE_PADDING)),
    y: Math.max(EDGE_PADDING, Math.min(y, window.innerHeight - height - EDGE_PADDING))
  };
};

/**
 * 从书签树中解析浏览器根目录 ID。
 */
const resolveBrowserRootFolderId = (tree: ReturnType<typeof usePopupStore.getState>['tree']): string | null => {
  const rootNode = tree.find((node) => node.type === 'folder' && !node.parentId);
  return rootNode?.id ?? null;
};

/**
 * Popup 主界面：目录与书签同树展示，目录下直接显示书签。
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
    createFolder,
    createBookmark,
    deleteFolder,
    updateBookmark,
    deleteBookmark
  } = usePopupStore();

  const [draggingBookmarkId, setDraggingBookmarkId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set<string>());
  const [contextMenu, setContextMenu] = useState<PopupContextMenuState | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditBookmarkDraft | null>(null);
  const [createFolderDraft, setCreateFolderDraft] = useState<CreateFolderDraft | null>(null);
  const [createBookmarkDraft, setCreateBookmarkDraft] = useState<CreateBookmarkDraft | null>(null);
  const [deleteFolderDraft, setDeleteFolderDraft] = useState<DeleteFolderDraft | null>(null);
  const [deletingItem, setDeletingItem] = useState<BookmarkIndexItem | null>(null);
  const [editFormError, setEditFormError] = useState('');
  const [folderFormError, setFolderFormError] = useState('');
  const [bookmarkFormError, setBookmarkFormError] = useState('');

  const folderElementMapRef = useRef<Map<string, HTMLButtonElement>>(new Map<string, HTMLButtonElement>());
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollFolderIdRef = useRef<string | null>(null);
  const hasStoredViewStateRef = useRef(false);
  const hasInitializedExpandStateRef = useRef(false);
  const [viewStateHydrated, setViewStateHydrated] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

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
  const folderMap = useMemo(() => flattenFolderTree(folderTree), [folderTree]);
  const browserRootFolderId = useMemo(() => resolveBrowserRootFolderId(tree), [tree]);
  const allFolderIds = useMemo(() => [ROOT_FOLDER_ID, ...collectAllFolderIds(folderTree)], [folderTree]);
  const allExpanded = allFolderIds.length > 0 && allFolderIds.every((folderId) => expandedFolderIds.has(folderId));

  const queryNorm = useMemo(() => normalizeText(query), [query]);
  const matchedItems = useMemo(() => {
    if (!queryNorm) {
      return items;
    }

    return items.filter((item) => item.titleNorm.includes(queryNorm) || item.urlNorm.includes(queryNorm));
  }, [items, queryNorm]);

  const { rootBookmarks, folderBookmarkMap } = useMemo(() => {
    const nextRootBookmarks: BookmarkIndexItem[] = [];
    const nextFolderBookmarkMap = new Map<string, BookmarkIndexItem[]>();

    matchedItems.forEach((item) => {
      if (!item.parentId || item.path.length === 0) {
        nextRootBookmarks.push(item);
        return;
      }

      const currentItems = nextFolderBookmarkMap.get(item.parentId) ?? [];
      currentItems.push(item);
      nextFolderBookmarkMap.set(item.parentId, currentItems);
    });

    return {
      rootBookmarks: nextRootBookmarks,
      folderBookmarkMap: nextFolderBookmarkMap
    };
  }, [matchedItems]);

  const visibleFolderIds = useMemo(() => {
    if (!queryNorm) {
      return null;
    }

    const visible = new Set<string>();

    const markVisible = (node: FolderViewNode): boolean => {
      const hasBookmark = (folderBookmarkMap.get(node.id)?.length ?? 0) > 0;
      const hasVisibleChild = node.children.some((child) => markVisible(child));
      if (hasBookmark || hasVisibleChild) {
        visible.add(node.id);
        return true;
      }
      return false;
    };

    folderTree.forEach((node) => {
      markVisible(node);
    });

    return visible;
  }, [folderBookmarkMap, folderTree, queryNorm]);

  useEffect(() => {
    if (!viewStateHydrated) {
      return;
    }

    const validFolderIds = new Set<string>(allFolderIds);
    setExpandedFolderIds((previous) => {
      const cleanedExpandedFolderIds = new Set<string>(
        Array.from(previous).filter((folderId) => validFolderIds.has(folderId))
      );

      if (!hasInitializedExpandStateRef.current) {
        hasInitializedExpandStateRef.current = true;
        if (!hasStoredViewStateRef.current) {
          return new Set<string>(allFolderIds);
        }
      }

      return cleanedExpandedFolderIds;
    });
  }, [allFolderIds, viewStateHydrated]);

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
  }, [expandedFolderIds, folderTree]);

  useEffect(() => {
    if (selectedFolderId === ROOT_FOLDER_ID) {
      return;
    }

    if (!folderMap.has(selectedFolderId)) {
      setSelectedFolderId(ROOT_FOLDER_ID);
    }
  }, [folderMap, selectedFolderId, setSelectedFolderId]);

  useEffect(() => {
    if (!viewStateHydrated) {
      return;
    }

    const snapshot = sanitizePopupViewStateSnapshot(
      {
        query,
        selectedFolderId,
        expandedFolderIds: Array.from(expandedFolderIds)
      },
      new Set<string>(allFolderIds)
    );
    void savePopupViewState(snapshot);
  }, [allFolderIds, expandedFolderIds, query, selectedFolderId, viewStateHydrated]);

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

  const openBookmarkMenu = (event: ReactMouseEvent<HTMLElement>, item: BookmarkIndexItem): void => {
    event.preventDefault();
    const position = clampMenuPosition(event.clientX, event.clientY, 198, 198);
    setContextMenu({ kind: 'bookmark', x: position.x, y: position.y, item });
  };

  const openFolderMenu = (
    event: ReactMouseEvent<HTMLElement>,
    folderId: string,
    title: string
  ): void => {
    event.preventDefault();
    const isRoot = folderId === ROOT_FOLDER_ID;
    const createParentId = isRoot ? browserRootFolderId : folderId;
    const position = clampMenuPosition(event.clientX, event.clientY, 198, 172);

    setContextMenu({ kind: 'folder', x: position.x, y: position.y, folderId, title, canDelete: !isRoot, createParentId });
  };

  const dropBookmarkToFolder = (folderId: string): void => {
    if (!draggingBookmarkId) {
      return;
    }

    const targetParentId = folderId === ROOT_FOLDER_ID ? browserRootFolderId : folderId;
    if (!targetParentId) {
      return;
    }

    void moveBookmark(draggingBookmarkId, targetParentId);
    setDraggingBookmarkId(null);
    setDropTargetFolderId(null);
  };

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
    const updated = await updateBookmark(editingDraft.id, title, url);
    if (!updated) {
      return;
    }

    setEditingDraft(null);
  };

  const submitCreateFolder = async (): Promise<void> => {
    if (!createFolderDraft) {
      return;
    }

    const title = createFolderDraft.title.trim();
    if (!title) {
      setFolderFormError('目录名称不能为空');
      return;
    }

    setFolderFormError('');
    const createdFolderId = await createFolder(createFolderDraft.parentId, title);
    if (!createdFolderId) {
      return;
    }

    setExpandedFolderIds((previous) => {
      const next = new Set<string>(previous);
      next.add(createFolderDraft.parentId);
      next.add(createdFolderId);
      return next;
    });
    setSelectedFolderId(createdFolderId);
    setCreateFolderDraft(null);
    pendingScrollFolderIdRef.current = createdFolderId;
  };

  const submitCreateBookmark = async (): Promise<void> => {
    if (!createBookmarkDraft) {
      return;
    }

    const title = createBookmarkDraft.title.trim();
    const url = createBookmarkDraft.url.trim();
    if (!url) {
      setBookmarkFormError('书签 URL 不能为空');
      return;
    }

    setBookmarkFormError('');
    const created = await createBookmark(createBookmarkDraft.parentId, title, url);
    if (!created) {
      return;
    }

    setCreateBookmarkDraft(null);
  };

  const confirmDeleteBookmark = async (): Promise<void> => {
    if (!deletingItem) {
      return;
    }

    const deleted = await deleteBookmark(deletingItem.id);
    if (!deleted) {
      return;
    }

    setDeletingItem(null);
  };

  const confirmDeleteFolder = async (): Promise<void> => {
    if (!deleteFolderDraft) {
      return;
    }

    const deleted = await deleteFolder(deleteFolderDraft.id);
    if (!deleted) {
      return;
    }

    setDeleteFolderDraft(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gradient-to-br from-slate-100 via-emerald-50 to-cyan-50 p-4 text-slate-800">
      {/* 顶栏区域：标题、状态与刷新入口。 */}
      <header className="mb-3 rounded-2xl border border-white/60 bg-white/80 p-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-wide">Bookmark Atlas</h1>
            <p className="text-xs text-slate-500">目录下直接显示书签，支持拖拽到其他目录。</p>
          </div>
          {/* 顶栏操作区：设置与刷新。 */}
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              onClick={() => void openOptionsPage()}
              type="button"
            >
              设置
            </button>
            <button
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
              onClick={() => void load()}
              type="button"
            >
              刷新
            </button>
          </div>
        </div>

        {/* 搜索框：全局匹配标题和 URL。 */}
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
      {moving ? <div className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">正在同步变更...</div> : null}
      {error ? <div className="mb-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      {/* 单窗口树区域：目录后直接展示其书签。 */}
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/60 bg-white/90 p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">目录树</h2>
          <button
            className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-200"
            onClick={() => setExpandedFolderIds(allExpanded ? new Set<string>() : new Set<string>(allFolderIds))}
            type="button"
          >
            {allExpanded ? '全部收起' : '全部展开'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ul className="space-y-1.5">
            <li>
              <div className="flex items-center gap-1">
                {rootBookmarks.length > 0 || folderTree.length > 0 ? (
                  <button
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 transition hover:bg-slate-100"
                    onClick={() => {
                      setExpandedFolderIds((previous) => {
                        const next = new Set<string>(previous);
                        if (next.has(ROOT_FOLDER_ID)) {
                          next.delete(ROOT_FOLDER_ID);
                        } else {
                          next.add(ROOT_FOLDER_ID);
                        }
                        return next;
                      });
                    }}
                    type="button"
                  >
                    {expandedFolderIds.has(ROOT_FOLDER_ID) ? '▼' : '▶'}
                  </button>
                ) : (
                  <span aria-hidden className="inline-block h-6 w-6" />
                )}

                <button
                  ref={(element) => {
                    if (element) {
                      folderElementMapRef.current.set(ROOT_FOLDER_ID, element);
                    } else {
                      folderElementMapRef.current.delete(ROOT_FOLDER_ID);
                    }
                  }}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    selectedFolderId === ROOT_FOLDER_ID
                      ? 'bg-emerald-100 text-emerald-900 shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100'
                  } ${dropTargetFolderId === ROOT_FOLDER_ID ? 'ring-2 ring-emerald-300' : ''}`}
                  onClick={() => setSelectedFolderId(ROOT_FOLDER_ID)}
                  onContextMenu={(event) => openFolderMenu(event, ROOT_FOLDER_ID, '根目录（未归档）')}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropTargetFolderId(ROOT_FOLDER_ID);
                  }}
                  onDragLeave={() => setDropTargetFolderId(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropBookmarkToFolder(ROOT_FOLDER_ID);
                  }}
                  type="button"
                >
                  {/* 根目录图标：与其他目录保持一致的视觉语义。 */}
                  <div className="inline-flex items-center gap-1.5">
                    <FolderIcon />
                    <span className="truncate">根目录（未归档）</span>
                  </div>
                </button>
              </div>

              {expandedFolderIds.has(ROOT_FOLDER_ID) ? (
                <div className="ml-6 mt-1 space-y-1">
                  {rootBookmarks.map((item) => (
                    <BookmarkRow
                      key={item.id}
                      item={item}
                      onOpenBookmarkMenu={openBookmarkMenu}
                      onDragBookmarkStart={setDraggingBookmarkId}
                      onDragBookmarkEnd={() => {
                        setDraggingBookmarkId(null);
                        setDropTargetFolderId(null);
                      }}
                    />
                  ))}

                  <BookmarkTree
                    nodes={folderTree}
                    selectedFolderId={selectedFolderId}
                    expandedFolderIds={expandedFolderIds}
                    folderBookmarkMap={folderBookmarkMap}
                    visibleFolderIds={visibleFolderIds}
                    dropTargetFolderId={dropTargetFolderId}
                    onSelectFolder={setSelectedFolderId}
                    onToggleExpand={(folderId) => {
                      setExpandedFolderIds((previous) => {
                        const next = new Set<string>(previous);
                        if (next.has(folderId)) {
                          next.delete(folderId);
                        } else {
                          next.add(folderId);
                        }
                        return next;
                      });
                    }}
                    onDragOverFolder={setDropTargetFolderId}
                    onDragLeaveFolder={() => setDropTargetFolderId(null)}
                    onDropToFolder={dropBookmarkToFolder}
                    onOpenFolderMenu={openFolderMenu}
                    onOpenBookmarkMenu={openBookmarkMenu}
                    onDragBookmarkStart={setDraggingBookmarkId}
                    onDragBookmarkEnd={() => {
                      setDraggingBookmarkId(null);
                      setDropTargetFolderId(null);
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
              ) : null}
            </li>
          </ul>
        </div>
      </section>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-50 w-[198px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.kind === 'bookmark' ? (
            <>
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={() => {
                  if (contextMenu.item.url) {
                    void browser.tabs.create({ url: contextMenu.item.url });
                  }
                  setContextMenu(null);
                }}
                type="button"
              >
                在新标签页中打开
              </button>
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={async () => {
                  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
                  if (activeTab?.id !== undefined && contextMenu.item.url) {
                    await browser.tabs.update(activeTab.id, { url: contextMenu.item.url });
                  }
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
                  setEditingDraft({ id: contextMenu.item.id, title: contextMenu.item.title, url: contextMenu.item.url ?? '' });
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
            </>
          ) : (
            <>
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={() => {
                  if (!contextMenu.createParentId) {
                    return;
                  }
                  setCreateFolderDraft({ parentId: contextMenu.createParentId, title: '' });
                  setFolderFormError('');
                  setContextMenu(null);
                }}
                type="button"
              >
                新建文件夹
              </button>
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={() => {
                  if (!contextMenu.createParentId) {
                    return;
                  }
                  setCreateBookmarkDraft({ parentId: contextMenu.createParentId, title: '', url: '' });
                  setBookmarkFormError('');
                  setContextMenu(null);
                }}
                type="button"
              >
                新建书签
              </button>
              <div className="my-1 border-t border-slate-200" />
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                disabled={!contextMenu.canDelete}
                onClick={() => {
                  if (!contextMenu.canDelete) {
                    return;
                  }
                  setDeleteFolderDraft({ id: contextMenu.folderId, title: contextMenu.title });
                  setContextMenu(null);
                }}
                type="button"
              >
                删除文件夹
              </button>
            </>
          )}
        </div>
      ) : null}

      {editingDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">编辑书签</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">标题</label>
            <input
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={editingDraft.title}
              onChange={(event) => setEditingDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))}
              type="text"
            />
            <label className="mb-2 block text-xs font-medium text-slate-600">URL</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={editingDraft.url}
              onChange={(event) => setEditingDraft((previous) => (previous ? { ...previous, url: event.target.value } : previous))}
              type="url"
            />
            {editFormError ? <p className="mt-2 text-xs text-rose-600">{editFormError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" onClick={() => setEditingDraft(null)} type="button">取消</button>
              <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700" onClick={() => void submitEditBookmark()} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {createFolderDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">新建文件夹</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">文件夹名称</label>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={createFolderDraft.title}
              onChange={(event) => setCreateFolderDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))}
              type="text"
            />
            {folderFormError ? <p className="mt-2 text-xs text-rose-600">{folderFormError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" onClick={() => setCreateFolderDraft(null)} type="button">取消</button>
              <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700" onClick={() => void submitCreateFolder()} type="button">创建</button>
            </div>
          </div>
        </div>
      ) : null}

      {createBookmarkDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">新建书签</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">标题</label>
            <input
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={createBookmarkDraft.title}
              onChange={(event) => setCreateBookmarkDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))}
              type="text"
            />
            <label className="mb-2 block text-xs font-medium text-slate-600">URL</label>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              value={createBookmarkDraft.url}
              onChange={(event) => setCreateBookmarkDraft((previous) => (previous ? { ...previous, url: event.target.value } : previous))}
              type="url"
            />
            {bookmarkFormError ? <p className="mt-2 text-xs text-rose-600">{bookmarkFormError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" onClick={() => setCreateBookmarkDraft(null)} type="button">取消</button>
              <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700" onClick={() => void submitCreateBookmark()} type="button">创建</button>
            </div>
          </div>
        </div>
      ) : null}

      {deletingItem ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-slate-800">删除书签</h3>
            <p className="mb-4 text-sm text-slate-600">确认删除“{deletingItem.title || '未命名书签'}”？该操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" onClick={() => setDeletingItem(null)} type="button">取消</button>
              <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm text-white transition hover:bg-rose-500" onClick={() => void confirmDeleteBookmark()} type="button">确认删除</button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteFolderDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-slate-800">删除文件夹</h3>
            <p className="mb-4 text-sm text-slate-600">确认删除“{deleteFolderDraft.title}”及其所有子目录和书签？该操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" onClick={() => setDeleteFolderDraft(null)} type="button">取消</button>
              <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm text-white transition hover:bg-rose-500" onClick={() => void confirmDeleteFolder()} type="button">确认删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
