import { describe, expect, it } from 'vitest';
import { defaultQuickSearchConfig, normalizeQuickSearchConfig } from './quick-search-config';

describe('defaultQuickSearchConfig', () => {
  it('should enable new tab opening and normal click window closing by default', () => {
    expect(defaultQuickSearchConfig).toEqual({
      openBookmarkInNewTab: true,
      closeWindowAfterBookmarkClick: true,
      closeWindowAfterContextMenuOpen: false
    });
  });
});

describe('normalizeQuickSearchConfig', () => {
  it('should preserve defaults for an absent configuration', () => {
    expect(normalizeQuickSearchConfig(undefined)).toEqual(defaultQuickSearchConfig);
  });

  it('should merge partial saved configuration with defaults', () => {
    expect(
      normalizeQuickSearchConfig({
        openBookmarkInNewTab: false
      })
    ).toEqual({
      openBookmarkInNewTab: false,
      closeWindowAfterBookmarkClick: true,
      closeWindowAfterContextMenuOpen: false
    });
  });

  it('should ignore invalid stored value types', () => {
    expect(
      normalizeQuickSearchConfig({
        openBookmarkInNewTab: 'false',
        closeWindowAfterBookmarkClick: null,
        closeWindowAfterContextMenuOpen: 1
      })
    ).toEqual(defaultQuickSearchConfig);
  });
});
