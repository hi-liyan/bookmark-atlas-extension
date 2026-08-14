
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Folder, X } from 'lucide-react';
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
  collectFolderSubtreeIds,
  flattenFolderTree,
  ROOT_FOLDER_ID,
  type FolderViewNode
} from './view-model';

interface BookmarkTreeProps {
  nodes: FolderViewNode[];
  selectedFolderId: string;
  expandedFolderIds: Set<string>;
  draggingBookmarkId: string | null;
  draggingFolderId: string | null;
  folderBookmarkMap: Map<string, BookmarkIndexItem[]>;
  visibleFolderIds: Set<string> | null;
  dropTargetFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onToggleExpand: (folderId: string) => void;
  onDragOverFolder: (folderId: string) => void;
  onDragLeaveFolder: () => void;
  onDropToFolder: (folderId: string) => void;
  onOpenFolderMenu: (event: ReactMouseEvent<HTMLElement>, folderId: string, title: string) => void;
  onOpenBookmark: (item: BookmarkIndexItem) => void;
  onOpenBookmarkMenu: (event: ReactMouseEvent<HTMLElement>, item: BookmarkIndexItem) => void;
  onDragBookmarkStart: (bookmarkId: string) => void;
  onDragBookmarkEnd: () => void;
  onDragFolderStart: (folderId: string) => void;
  onDragFolderEnd: () => void;
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

interface RenameFolderDraft {
  id: string;
  title: string;
}

/**
 * 目录图标：用于在目录名称前提供统一视觉标识。
 * 入参：无。
 * 出参：目录 SVG 图标。
 */
const FolderIcon = () => {
  return <Folder aria-hidden className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.75} />;
};

/**
 * 渲染单条书签行，支持右键和拖拽移动。
 * 入参：书签项与交互回调。
 * 出参：书签 JSX 节点。
 */
const BookmarkRow = ({
  item,
  isDragging,
  onOpenBookmark,
  onOpenBookmarkMenu,
  onDragBookmarkStart,
  onDragBookmarkEnd
}: {
  item: BookmarkIndexItem;
  isDragging: boolean;
  onOpenBookmark: (targetItem: BookmarkIndexItem) => void;
  onOpenBookmarkMenu: (event: ReactMouseEvent<HTMLElement>, targetItem: BookmarkIndexItem) => void;
  onDragBookmarkStart: (bookmarkId: string) => void;
  onDragBookmarkEnd: () => void;
}) => {
  const [dragEnabled, setDragEnabled] = useState(true);

  return (
    <article
      className={`rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition ${
        isDragging ? 'cursor-grabbing opacity-60 ring-2 ring-[#138052]/35' : ''
      }`}
      draggable={dragEnabled}
      onMouseDownCapture={(event) => {
        const target = event.target as HTMLElement | null;
        const pressedOnText = Boolean(target?.closest('[data-bookmark-text="true"]'));
        // 在文字区域按下时临时关闭 draggable，确保拖选文字不会被解释为“拖动书签”。
        setDragEnabled(!pressedOnText);
      }}
      onMouseUpCapture={() => {
        setDragEnabled(true);
      }}
      onMouseLeave={() => {
        setDragEnabled(true);
      }}
      onDragStart={(event) => {
        const dragTarget = event.target as HTMLElement | null;
        // 文字区域允许正常选中文本；从文字区域起手时不触发“移动书签”拖拽。
        const selectedText = window.getSelection()?.toString().trim() ?? '';
        if (dragTarget?.closest('[data-bookmark-text="true"]') || selectedText.length > 0) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/bookmark-id', item.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragBookmarkStart(item.id);
      }}
      onDragEnd={onDragBookmarkEnd}
      onDoubleClick={() => onOpenBookmark(item)}
      onContextMenu={(event) => onOpenBookmarkMenu(event, item)}
    >
      {/* 书签主体：左侧 favicon，右侧标题与 URL。 */}
      <div className="flex items-start gap-2">
        {/* 站点图标：优先显示 favicon，失败时回退首字母。 */}
        <BookmarkFavicon url={item.url} title={item.title} sizeClassName="mt-0.5 h-4 w-4" />
        <div className="inline-flex min-w-0 max-w-full flex-col" data-bookmark-text="true">
          <p className="cursor-text select-text break-all whitespace-normal text-xs font-medium leading-4 text-slate-800">
            {item.title || '未命名书签'}
          </p>
          <p className="line-clamp-1 cursor-text select-text text-[11px] text-slate-500">{item.url ?? '-'}</p>
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
  draggingBookmarkId,
  draggingFolderId,
  folderBookmarkMap,
  visibleFolderIds,
  dropTargetFolderId,
  onSelectFolder,
  onToggleExpand,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropToFolder,
  onOpenFolderMenu,
  onOpenBookmark,
  onOpenBookmarkMenu,
  onDragBookmarkStart,
  onDragBookmarkEnd,
  onDragFolderStart,
  onDragFolderEnd,
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
        const draggingFolder = node.id === draggingFolderId;

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
                  selected ? 'bg-[#138052]/12 text-[#138052] shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                } ${dropTarget ? 'ring-2 ring-[#138052]/35' : ''} ${
                  draggingFolder ? 'cursor-grabbing opacity-60 ring-2 ring-cyan-300' : ''
                }`}
                draggable
                onClick={() => onSelectFolder(node.id)}
                onDoubleClick={() => onToggleExpand(node.id)}
                onContextMenu={(event) => onOpenFolderMenu(event, node.id, node.title)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/folder-id', node.id);
                  event.dataTransfer.effectAllowed = 'move';
                  onDragFolderStart(node.id);
                }}
                onDragEnd={onDragFolderEnd}
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
                <div className="inline-flex items-start gap-1.5">
                  <FolderIcon />
                  <span className="break-all whitespace-normal leading-5">{node.title}</span>
                </div>
              </button>
            </div>

            {expanded ? (
              <div className="ml-6 mt-1 space-y-1">
                {folderBookmarks.map((item) => (
                  <BookmarkRow
                    key={item.id}
                    item={item}
                    isDragging={draggingBookmarkId === item.id}
                    onOpenBookmark={onOpenBookmark}
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
                    draggingBookmarkId={draggingBookmarkId}
                    draggingFolderId={draggingFolderId}
                    folderBookmarkMap={folderBookmarkMap}
                    visibleFolderIds={visibleFolderIds}
                    dropTargetFolderId={dropTargetFolderId}
                    onSelectFolder={onSelectFolder}
                    onToggleExpand={onToggleExpand}
                    onDragOverFolder={onDragOverFolder}
                    onDragLeaveFolder={onDragLeaveFolder}
                    onDropToFolder={onDropToFolder}
                    onOpenFolderMenu={onOpenFolderMenu}
                    onOpenBookmark={onOpenBookmark}
                    onOpenBookmarkMenu={onOpenBookmarkMenu}
                    onDragBookmarkStart={onDragBookmarkStart}
                    onDragBookmarkEnd={onDragBookmarkEnd}
                    onDragFolderStart={onDragFolderStart}
                    onDragFolderEnd={onDragFolderEnd}
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
    moveFolder,
    createFolder,
    createBookmark,
    deleteFolder,
    renameFolder,
    updateBookmark,
    deleteBookmark
  } = usePopupStore();

  const [draggingBookmarkId, setDraggingBookmarkId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set<string>());
  const [contextMenu, setContextMenu] = useState<PopupContextMenuState | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditBookmarkDraft | null>(null);
  const [createFolderDraft, setCreateFolderDraft] = useState<CreateFolderDraft | null>(null);
  const [createBookmarkDraft, setCreateBookmarkDraft] = useState<CreateBookmarkDraft | null>(null);
  const [deleteFolderDraft, setDeleteFolderDraft] = useState<DeleteFolderDraft | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState<RenameFolderDraft | null>(null);
  const [deletingItem, setDeletingItem] = useState<BookmarkIndexItem | null>(null);
  const [editFormError, setEditFormError] = useState('');
  const [folderFormError, setFolderFormError] = useState('');
  const [renameFormError, setRenameFormError] = useState('');
  const [bookmarkFormError, setBookmarkFormError] = useState('');

  const folderElementMapRef = useRef<Map<string, HTMLButtonElement>>(new Map<string, HTMLButtonElement>());
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollFolderIdRef = useRef<string | null>(null);
  const hasStoredViewStateRef = useRef(false);
  const hasInitializedExpandStateRef = useRef(false);
  const [viewStateHydrated, setViewStateHydrated] = useState(false);
  // 扩展版本号：从 manifest 动态读取，避免手写版本导致显示与打包不一致。
  const extensionVersion = useMemo(() => browser.runtime.getManifest().version, []);

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
  // 仅在目录树真实加载完成后，才执行视图状态的清洗与持久化，避免空树阶段覆盖历史状态。
  const hasLoadedTree = !loading && tree.length > 0;
  const allFolderIds = useMemo(() => [ROOT_FOLDER_ID, ...collectAllFolderIds(folderTree)], [folderTree]);
  const allExpanded = allFolderIds.length > 0 && allFolderIds.every((folderId) => expandedFolderIds.has(folderId));

  const queryNorm = useMemo(() => normalizeText(query), [query]);
  const hasSearchQuery = queryNorm.length > 0;
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
    if (!viewStateHydrated || !hasLoadedTree) {
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
  }, [allFolderIds, hasLoadedTree, viewStateHydrated]);

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
    if (!hasLoadedTree) {
      return;
    }

    if (selectedFolderId === ROOT_FOLDER_ID) {
      return;
    }

    if (!folderMap.has(selectedFolderId)) {
      setSelectedFolderId(ROOT_FOLDER_ID);
    }
  }, [folderMap, hasLoadedTree, selectedFolderId, setSelectedFolderId]);

  useEffect(() => {
    if (!viewStateHydrated || !hasLoadedTree) {
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
  }, [allFolderIds, expandedFolderIds, hasLoadedTree, query, selectedFolderId, viewStateHydrated]);

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

  /**
   * 双击书签时在新标签页打开，保持与右键“在新标签页中打开”一致。
   */
  const openBookmarkInNewTab = (item: BookmarkIndexItem): void => {
    if (!item.url) {
      return;
    }
    void browser.tabs.create({ url: item.url });
  };

  const openFolderMenu = (
    event: ReactMouseEvent<HTMLElement>,
    folderId: string,
    title: string
  ): void => {
    event.preventDefault();
    const isRoot = folderId === ROOT_FOLDER_ID;
    const createParentId = isRoot ? browserRootFolderId : folderId;
    const position = clampMenuPosition(event.clientX, event.clientY, 198, 208);

    setContextMenu({ kind: 'folder', x: position.x, y: position.y, folderId, title, canDelete: !isRoot, createParentId });
  };

  /**
   * 统一处理拖拽释放到目录的行为：支持书签与目录两类拖拽源。
   */
  const dropToFolder = (folderId: string): void => {
    const targetParentId = folderId === ROOT_FOLDER_ID ? browserRootFolderId : folderId;
    if (!targetParentId) {
      return;
    }

    if (draggingBookmarkId) {
      void moveBookmark(draggingBookmarkId, targetParentId);
      setDraggingBookmarkId(null);
      setDropTargetFolderId(null);
      return;
    }

    if (!draggingFolderId) {
      return;
    }

    const currentFolderSubtreeIds = collectFolderSubtreeIds(folderTree, draggingFolderId);
    // 禁止把目录拖到自己或自己的子目录下，避免形成循环层级。
    if (draggingFolderId === targetParentId || currentFolderSubtreeIds.has(targetParentId)) {
      setDraggingFolderId(null);
      setDropTargetFolderId(null);
      return;
    }

    void moveFolder(draggingFolderId, targetParentId);
    setDraggingFolderId(null);
    setDraggingBookmarkId(null);
    setDropTargetFolderId(null);
  };

  /**
   * 开始拖拽书签时，清理目录拖拽状态，避免两类拖拽源并发冲突。
   */
  const startDraggingBookmark = (bookmarkId: string): void => {
    setDraggingFolderId(null);
    setDraggingBookmarkId(bookmarkId);
  };

  /**
   * 结束拖拽书签时，统一清理拖拽态与高亮目标目录。
   */
  const endDraggingBookmark = (): void => {
    setDraggingBookmarkId(null);
    setDropTargetFolderId(null);
  };

  /**
   * 开始拖拽目录时，清理书签拖拽状态，保证拖拽源唯一。
   */
  const startDraggingFolder = (folderId: string): void => {
    setDraggingBookmarkId(null);
    setDraggingFolderId(folderId);
  };

  /**
   * 结束拖拽目录时，统一清理拖拽态与高亮目标目录。
   */
  const endDraggingFolder = (): void => {
    setDraggingFolderId(null);
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

  /**
   * \u63d0\u4ea4\u76ee\u5f55\u91cd\u547d\u540d\uff1a\u6821\u9a8c\u8f93\u5165\u540e\u8c03\u7528 store\uff0c\u5e76\u5728\u6210\u529f\u65f6\u5173\u95ed\u5f39\u7a97\u3002
   */
  const submitRenameFolder = async (): Promise<void> => {
    if (!renameFolderDraft) {
      return;
    }

    const title = renameFolderDraft.title.trim();
    if (!title) {
      setRenameFormError('文件夹名称不能为空');
      return;
    }

    setRenameFormError('');
    const renamed = await renameFolder(renameFolderDraft.id, title);
    if (!renamed) {
      return;
    }

    setRenameFolderDraft(null);
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
    <div className="flex h-full flex-col overflow-hidden bg-[#EFF3F7] p-4 text-slate-800">
      {/* 顶部信息与操作区：左侧产品信息，右侧设置与刷新按钮。 */}
      <div className="mb-2 flex items-start justify-between gap-3 px-1">
        <div>
          {/* 应用品牌区：展示产品名、宣传语与动态版本号。 */}
          <h1 className="flex items-end gap-2 text-lg font-semibold tracking-wide">
            <span>快书签</span>
            <span className="pb-0.5 text-xs font-normal text-slate-400">v{extensionVersion}</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">Find it. Open it. Instantly.</p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
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
      {/* 搜索卡片区：仅保留搜索输入。 */}
      <header className="mb-3 rounded-[15px] bg-white p-3 shadow-sm backdrop-blur">
        {/* 搜索框：全局匹配标题和 URL。 */}
        <label className="flex items-center gap-2 rounded-[10px] bg-[#EFF3F7] px-3 py-2">
          <span className="text-slate-400">⌕</span>
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="全局搜索标题或 URL"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/* 清空按钮：仅在有搜索词时显示，便于快速恢复全量列表。 */}
          {query.length > 0 ? (
            <button
              aria-label="清空搜索"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setQuery('')}
              type="button"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </header>

      {loading ? <div className="mb-3 rounded-lg bg-cyan-100 px-3 py-2 text-sm text-cyan-800">正在加载书签...</div> : null}
      {moving ? <div className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">正在同步变更...</div> : null}
      {error ? <div className="mb-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

      {/* 单窗口树区域：目录后直接展示其书签。 */}
      <section className="flex min-h-0 flex-1 flex-col rounded-[15px] bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">{hasSearchQuery ? '搜索结果' : '目录树'}</h2>
          {!hasSearchQuery ? (
            <button
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-200"
              onClick={() => setExpandedFolderIds(allExpanded ? new Set<string>() : new Set<string>(allFolderIds))}
              type="button"
            >
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-3 [scrollbar-gutter:stable]">
          {hasSearchQuery ? (
            <>
              {/* 搜索态列表：隐藏目录树，仅显示匹配到的书签。 */}
              {matchedItems.length === 0 ? (
                <div className="px-2 py-4 text-sm text-slate-500">没有匹配的书签</div>
              ) : (
                <ul className="space-y-1.5">
                  {matchedItems.map((item) => (
                    <li key={item.id}>
                      <BookmarkRow
                        item={item}
                        isDragging={draggingBookmarkId === item.id}
                        onOpenBookmark={openBookmarkInNewTab}
                        onOpenBookmarkMenu={openBookmarkMenu}
                        onDragBookmarkStart={startDraggingBookmark}
                        onDragBookmarkEnd={endDraggingBookmark}
                      />
                      {/* 搜索结果路径：帮助用户判断书签所属位置。 */}
                      <p className="ml-7 mt-1 break-all whitespace-normal text-[11px] text-slate-400">
                        {item.path.join(' / ') || '根目录'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
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
                        ? 'bg-[#138052]/12 text-[#138052] shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100'
                    } ${dropTargetFolderId === ROOT_FOLDER_ID ? 'ring-2 ring-[#138052]/35' : ''}`}
                    onClick={() => setSelectedFolderId(ROOT_FOLDER_ID)}
                    onDoubleClick={() => {
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
                    onContextMenu={(event) => openFolderMenu(event, ROOT_FOLDER_ID, '根目录（未归档）')}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTargetFolderId(ROOT_FOLDER_ID);
                    }}
                    onDragLeave={() => setDropTargetFolderId(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropToFolder(ROOT_FOLDER_ID);
                    }}
                    type="button"
                  >
                    {/* 根目录图标：与其他目录保持一致的视觉语义。 */}
                    <div className="inline-flex items-start gap-1.5">
                      <FolderIcon />
                      <span className="break-all whitespace-normal leading-5">根目录（未归档）</span>
                    </div>
                  </button>
                </div>

                {expandedFolderIds.has(ROOT_FOLDER_ID) ? (
                  <div className="ml-6 mt-1 space-y-1">
                    {rootBookmarks.map((item) => (
                      <BookmarkRow
                        key={item.id}
                        item={item}
                        isDragging={draggingBookmarkId === item.id}
                        onOpenBookmark={openBookmarkInNewTab}
                        onOpenBookmarkMenu={openBookmarkMenu}
                        onDragBookmarkStart={startDraggingBookmark}
                        onDragBookmarkEnd={endDraggingBookmark}
                      />
                    ))}

                    <BookmarkTree
                      nodes={folderTree}
                      selectedFolderId={selectedFolderId}
                      expandedFolderIds={expandedFolderIds}
                      draggingBookmarkId={draggingBookmarkId}
                      draggingFolderId={draggingFolderId}
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
                      onDropToFolder={dropToFolder}
                      onOpenFolderMenu={openFolderMenu}
                      onOpenBookmark={openBookmarkInNewTab}
                      onOpenBookmarkMenu={openBookmarkMenu}
                      onDragBookmarkStart={startDraggingBookmark}
                      onDragBookmarkEnd={endDraggingBookmark}
                      onDragFolderStart={startDraggingFolder}
                      onDragFolderEnd={endDraggingFolder}
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
          )}
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
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                disabled={!contextMenu.canDelete}
                onClick={() => {
                  if (!contextMenu.canDelete) {
                    return;
                  }
                  setRenameFolderDraft({ id: contextMenu.folderId, title: contextMenu.title });
                  setRenameFormError('');
                  setContextMenu(null);
                }}
                type="button"
              >重命名</button>
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
          <div className="w-full max-w-md rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">编辑书签</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">标题</label>
            <input
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#138052]"
              value={editingDraft.title}
              onChange={(event) => setEditingDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))}
              type="text"
            />
            <label className="mb-2 block text-xs font-medium text-slate-600">URL</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#138052]"
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
          <div className="w-full max-w-md rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">新建文件夹</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">文件夹名称</label>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#138052]"
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

      {renameFolderDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
            {/* \u91cd\u547d\u540d\u5f39\u7a97\uff1a\u7528\u4e8e\u4fee\u6539\u76ee\u5f55\u540d\u79f0\uff0c\u907f\u514d\u8bef\u89e6\u5220\u9664\u3002 */}
            <h3 className="mb-3 text-base font-semibold text-slate-800">重命名文件夹</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">文件夹名称</label>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#138052]"
              value={renameFolderDraft.title}
              onChange={(event) => setRenameFolderDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))}
              type="text"
            />
            {renameFormError ? <p className="mt-2 text-xs text-rose-600">{renameFormError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" onClick={() => setRenameFolderDraft(null)} type="button">取消</button>
              <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700" onClick={() => void submitRenameFolder()} type="button">保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {createBookmarkDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">新建书签</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">标题</label>
            <input
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#138052]"
              value={createBookmarkDraft.title}
              onChange={(event) => setCreateBookmarkDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))}
              type="text"
            />
            <label className="mb-2 block text-xs font-medium text-slate-600">URL</label>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#138052]"
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
          <div className="w-full max-w-sm rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
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
          <div className="w-full max-w-sm rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
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
