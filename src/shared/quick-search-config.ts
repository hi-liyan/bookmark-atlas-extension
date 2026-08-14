import type { QuickSearchConfig } from './types';

export const QUICK_SEARCH_CONFIG_STORAGE_KEY = 'quick-search-config';

export const defaultQuickSearchConfig: QuickSearchConfig = {
  openBookmarkInNewTab: true,
  closeWindowAfterBookmarkClick: true,
  closeWindowAfterContextMenuOpen: false
};

/**
 * 合并本地已保存配置与默认值，兼容新增字段前保存的旧版本配置。
 * 入参：本地存储读取到的未知配置值。
 * 出参：字段完整且类型正确的快速搜索配置。
 */
export const normalizeQuickSearchConfig = (storedValue: unknown): QuickSearchConfig => {
  if (!storedValue || typeof storedValue !== 'object') {
    return defaultQuickSearchConfig;
  }

  const storedConfig = storedValue as Partial<QuickSearchConfig>;
  return {
    openBookmarkInNewTab:
      typeof storedConfig.openBookmarkInNewTab === 'boolean'
        ? storedConfig.openBookmarkInNewTab
        : defaultQuickSearchConfig.openBookmarkInNewTab,
    closeWindowAfterBookmarkClick:
      typeof storedConfig.closeWindowAfterBookmarkClick === 'boolean'
        ? storedConfig.closeWindowAfterBookmarkClick
        : defaultQuickSearchConfig.closeWindowAfterBookmarkClick,
    closeWindowAfterContextMenuOpen:
      typeof storedConfig.closeWindowAfterContextMenuOpen === 'boolean'
        ? storedConfig.closeWindowAfterContextMenuOpen
        : defaultQuickSearchConfig.closeWindowAfterContextMenuOpen
  };
};
