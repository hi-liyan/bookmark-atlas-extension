import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '../shared/browser';
import type { BookmarkIndexItem, RuntimeResponse } from '../shared/types';
import { buildQuickSearchResults, clampHighlightIndex } from './quick-search-service';

/**
 * 请求背景页书签索引，为快捷搜索提供数据源。
 * 入参：无。
 * 出参：书签索引项数组。
 */
const loadBookmarkItems = async (): Promise<BookmarkIndexItem[]> => {
  const response = (await browser.runtime.sendMessage({
    type: 'bookmarks/get-index'
  })) as RuntimeResponse;

  if (!response.ok || !('index' in response)) {
    throw new Error(response.ok ? 'Invalid index response.' : response.error);
  }

  return response.index.items;
};

/**
 * 打开目标书签到新标签页，并关闭当前快捷搜索窗口。
 * 入参：书签索引项。
 * 出参：Promise<void>。
 */
const openBookmarkInNewTab = async (item: BookmarkIndexItem): Promise<void> => {
  if (!item.url) {
    return;
  }

  await browser.tabs.create({ url: item.url });
  window.close();
};

/**
 * 快捷搜索主界面：支持键盘导航、回车打开与鼠标点击打开。
 */
export const QuickSearchApp = () => {
  const [allItems, setAllItems] = useState<BookmarkIndexItem[]>([]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

                if (event.key === 'Escape') {
                  event.preventDefault();
                  window.close();
                }
              }}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">方向键选择，Enter 新标签打开，Esc 关闭</p>
        </header>

        {/* 列表区域：展示搜索候选项并支持鼠标点击打开 */}
        <section className="min-h-0 flex-1 rounded-2xl border border-white/70 bg-white/90 p-1.5 shadow-sm sm:p-2">
          {loading ? <div className="px-3 py-4 text-sm text-cyan-700">正在加载书签索引...</div> : null}
          {error ? <div className="px-3 py-4 text-sm text-rose-700">{error}</div> : null}
          {!loading && !error && results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-500">没有匹配项</div>
          ) : null}

          {!loading && !error && results.length > 0 ? (
            <ul className="h-full space-y-1 overflow-y-auto">
              {results.map((item, index) => {
                const isActive = index === activeIndex;
                return (
                  <li key={item.id}>
                    {/* 结果项按钮：高亮当前键盘选中项，支持点击直接打开 */}
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
                      onClick={() => {
                        void openBookmarkInNewTab(item);
                      }}
                      type="button"
                    >
                      <p className="line-clamp-1 text-sm font-medium">{item.title || '未命名书签'}</p>
                      <p className="line-clamp-1 text-xs text-slate-500">{item.url ?? '-'}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                        {item.path.join(' / ') || '根目录'}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
};
