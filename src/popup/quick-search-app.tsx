import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { X } from 'lucide-react';
import type { BookmarkIndexItem } from '../shared/types';
import { BookmarkFavicon } from './bookmark-favicon';
import {
  buildEditTagDraft,
  deleteTagFromQuickSearch,
  type EditTagDraft,
  loadBookmarkItems,
  openBookmarkInNewTab,
  updateTagFromQuickSearch,
  validateEditTagDraft
} from './quick-search-actions';
import { applyBookmarkEditOptimistically } from './index-items';
import { resolveQuickSearchEscapeAction } from './quick-search-keyboard';
import { buildQuickSearchResults, clampHighlightIndex } from './quick-search-service';

interface BookmarkContextMenuState {
  x: number;
  y: number;
  item: BookmarkIndexItem;
}

/**
 * 快捷搜索主界面：支持键盘导航、回车打开与标签编辑删除。
 */
export const QuickSearchApp = () => {
  const [allItems, setAllItems] = useState<BookmarkIndexItem[]>([]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editingDraft, setEditingDraft] = useState<EditTagDraft | null>(null);
  const [deletingItem, setDeletingItem] = useState<BookmarkIndexItem | null>(null);
  const [editFormError, setEditFormError] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [contextMenu, setContextMenu] = useState<BookmarkContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setError('');
        const items = await loadBookmarkItems();
        if (cancelled) {
          return;
        }
        setAllItems(items);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : '加载失败';
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => buildQuickSearchResults(allItems, query, 30), [allItems, query]);

  useEffect(() => {
    // 搜索词或结果变化时重置高亮索引，保证 Enter 的行为可预期。
    setActiveIndex((previous) => clampHighlightIndex(previous, results.length));
  }, [results.length, query]);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }

    // 键盘导航时自动滚动到当前高亮项，避免用户看不见当前选择。
    resultItemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  /**
   * 统一关闭右键菜单：点击菜单外区域时触发。
   * 入参：无。
   * 出参：void。
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

    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  /**
   * 统一处理全局 Esc：优先关闭当前层级弹层，最后再关闭快捷搜索窗口。
   * 入参：无。
   * 出参：void。
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) {
        return;
      }

      const action = resolveQuickSearchEscapeAction({
        hasEditingDraft: editingDraft !== null,
        hasDeletingItem: deletingItem !== null,
        hasContextMenu: contextMenu !== null
      });

      // 阻止默认行为（例如 search input 内部清空）以保证 Esc 行为稳定一致。
      event.preventDefault();
      if (action === 'close-edit-dialog') {
        setEditingDraft(null);
        setEditFormError('');
        return;
      }
      if (action === 'close-delete-dialog') {
        setDeletingItem(null);
        return;
      }
      if (action === 'close-context-menu') {
        setContextMenu(null);
        return;
      }
      window.close();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [contextMenu, deletingItem, editingDraft]);

  /**
   * 重新拉取快捷搜索索引数据，供初始化加载时写入列表。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const reloadItems = async (): Promise<void> => {
    const items = await loadBookmarkItems();
    setAllItems(items);
  };

  /**
   * 打开右键菜单，并在窗口边界内修正坐标防止溢出。
   * 入参：鼠标事件、当前书签项、结果索引。
   * 出参：void。
   */
  const openContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: BookmarkIndexItem,
    index: number
  ): void => {
    event.preventDefault();
    const MENU_WIDTH = 170;
    const MENU_HEIGHT = 96;
    const EDGE_PADDING = 8;

    const x = Math.max(
      EDGE_PADDING,
      Math.min(event.clientX, window.innerWidth - MENU_WIDTH - EDGE_PADDING)
    );
    const y = Math.max(
      EDGE_PADDING,
      Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - EDGE_PADDING)
    );

    setActiveIndex(index);
    setContextMenu({ x, y, item });
  };

  /**
   * 提交标签编辑：先乐观更新列表，再提交后端并在失败时回滚。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const submitEditTag = async (): Promise<void> => {
    if (!editingDraft) {
      return;
    }

    const validation = validateEditTagDraft(editingDraft);
    if (!validation.ok) {
      setEditFormError(validation.error);
      return;
    }

    setSubmittingAction(true);
    setActionError('');
    setEditFormError('');

    // 先在本地更新列表，避免依赖索引回读导致用户看不到最新编辑结果。
    const previousItems = allItems;
    const normalizedDraft: EditTagDraft = {
      ...editingDraft,
      title: validation.title,
      url: validation.url
    };
    setAllItems((items) =>
      applyBookmarkEditOptimistically(items, {
        bookmarkId: normalizedDraft.id,
        title: normalizedDraft.title,
        url: normalizedDraft.url
      })
    );

    try {
      await updateTagFromQuickSearch(normalizedDraft);
      setEditingDraft(null);
      setContextMenu(null);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : '编辑标签失败';
      setAllItems(previousItems);
      setActionError(message);
    } finally {
      setSubmittingAction(false);
    }
  };

  /**
   * 确认删除标签：先乐观移除列表项，失败时回滚并提示错误。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const confirmDeleteTag = async (): Promise<void> => {
    if (!deletingItem) {
      return;
    }

    setSubmittingAction(true);
    setActionError('');

    const targetBookmarkId = deletingItem.id;
    const previousItems = allItems;
    setAllItems((items) => items.filter((item) => item.id !== targetBookmarkId));

    try {
      await deleteTagFromQuickSearch(targetBookmarkId);
      setDeletingItem(null);
      setContextMenu(null);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : '删除标签失败';
      // 删除失败时回滚乐观更新，避免列表丢失但实际数据仍存在。
      setAllItems(previousItems);
      setActionError(message);
    } finally {
      setSubmittingAction(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-br from-amber-50 via-lime-50 to-cyan-50 p-2 text-slate-800 sm:p-4">
      {/* 主容器区域：根据窗口大小自适应，避免缩小时内容挤压裁切 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 顶部输入区：模拟 Spotlight 的聚焦搜索入口 */}
        <header className="mb-2 rounded-2xl border border-white/70 bg-white/90 p-2 shadow-sm sm:mb-3 sm:p-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <span className="text-slate-400">⌕</span>
            <input
              ref={inputRef}
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="输入关键字搜索书签..."
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((previous) => clampHighlightIndex(previous + 1, results.length));
                  return;
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((previous) => clampHighlightIndex(previous - 1, results.length));
                  return;
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (activeIndex < 0 || activeIndex >= results.length) {
                    return;
                  }
                  void openBookmarkInNewTab(results[activeIndex]);
                  return;
                }

              }}
            />
            {/* 清空按钮：仅在有搜索词时展示，减少手动删除输入的操作成本。 */}
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
          <p className="mt-2 text-xs text-slate-500">方向键选择，Enter 新标签打开，右键可编辑/删除标签</p>
        </header>

        {/* 列表区域：展示搜索候选项并支持鼠标点击打开 */}
        <section className="min-h-0 flex-1 rounded-2xl border border-white/70 bg-white/90 p-1.5 shadow-sm sm:p-2">
          {loading ? <div className="px-3 py-4 text-sm text-cyan-700">正在加载书签索引...</div> : null}
          {error ? <div className="px-3 py-4 text-sm text-rose-700">{error}</div> : null}
          {actionError ? <div className="px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
          {!loading && !error && results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-500">没有匹配项</div>
          ) : null}

          {!loading && !error && results.length > 0 ? (
            <ul className="h-full space-y-1 overflow-y-auto">
              {results.map((item, index) => {
                const isActive = index === activeIndex;
                return (
                  <li key={item.id}>
                    {/* 结果项按钮：高亮当前键盘选中项，支持点击打开与右键菜单 */}
                    <button
                      ref={(element) => {
                        resultItemRefs.current[index] = element;
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                        isActive
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                          : 'border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50'
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onContextMenu={(event) => openContextMenu(event, item, index)}
                      onClick={() => {
                        void openBookmarkInNewTab(item);
                      }}
                      type="button"
                    >
                      {/* 搜索项主体：左侧 favicon + 右侧标题、URL 与路径 */}
                      <div className="flex items-start gap-2">
                        {/* 站点图标：与主 popup 保持同一渲染策略 */}
                        <BookmarkFavicon url={item.url} title={item.title} sizeClassName="mt-0.5 h-5 w-5" />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-sm font-medium">{item.title || '未命名书签'}</p>
                          <p className="line-clamp-1 text-xs text-slate-500">{item.url ?? '-'}</p>
                          <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                            {item.path.join(' / ') || '根目录'}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-30 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* 右键菜单：承载快捷搜索内的标签编辑与删除操作 */}
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submittingAction}
            onClick={() => {
              setActionError('');
              setEditFormError('');
              setEditingDraft(buildEditTagDraft(contextMenu.item));
              setContextMenu(null);
            }}
            type="button"
          >
            编辑标签
          </button>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submittingAction}
            onClick={() => {
              setActionError('');
              setDeletingItem(contextMenu.item);
              setContextMenu(null);
            }}
            type="button"
          >
            删除标签
          </button>
        </div>
      ) : null}

      {editingDraft ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          {/* 标签编辑弹窗：支持直接修改标题与 URL */}
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-slate-800">编辑标签</h3>
            <label className="mb-2 block text-xs font-medium text-slate-600">标签标题</label>
            <input
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              disabled={submittingAction}
              value={editingDraft.title}
              onChange={(event) =>
                setEditingDraft((previous) =>
                  previous ? { ...previous, title: event.target.value } : previous
                )
              }
              type="text"
            />
            <label className="mb-2 block text-xs font-medium text-slate-600">标签 URL</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-400"
              disabled={submittingAction}
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
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submittingAction}
                onClick={() => {
                  setEditingDraft(null);
                  setEditFormError('');
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submittingAction}
                onClick={() => {
                  void submitEditTag();
                }}
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
          {/* 标签删除确认弹窗：满足二次确认后才执行删除 */}
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-slate-800">删除标签</h3>
            <p className="mb-4 text-sm text-slate-600">
              确认删除“{deletingItem.title || '未命名书签'}”？该操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submittingAction}
                onClick={() => setDeletingItem(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submittingAction}
                onClick={() => {
                  void confirmDeleteTag();
                }}
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
