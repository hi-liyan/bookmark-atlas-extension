import { resolveQuickSearchEscapeAction, type QuickSearchEscapeContext } from './quick-search-keyboard';

/**
 * 构建 Esc 场景上下文，避免每个测试重复拼装默认值。
 * 入参：需要覆盖的上下文字段。
 * 出参：完整上下文对象。
 */
const createContext = (
  overrides: Partial<QuickSearchEscapeContext> = {}
): QuickSearchEscapeContext => ({
  hasEditingDraft: false,
  hasDeletingItem: false,
  hasContextMenu: false,
  ...overrides
});

describe('resolveQuickSearchEscapeAction', () => {
  it('should close edit dialog first when edit dialog is open', () => {
    const action = resolveQuickSearchEscapeAction(
      createContext({ hasEditingDraft: true, hasDeletingItem: true, hasContextMenu: true })
    );

    expect(action).toBe('close-edit-dialog');
  });

  it('should close delete dialog when delete dialog is open without edit dialog', () => {
    const action = resolveQuickSearchEscapeAction(
      createContext({ hasDeletingItem: true, hasContextMenu: true })
    );

    expect(action).toBe('close-delete-dialog');
  });

  it('should close context menu when only context menu is open', () => {
    const action = resolveQuickSearchEscapeAction(createContext({ hasContextMenu: true }));

    expect(action).toBe('close-context-menu');
  });

  it('should close window when no overlay is open', () => {
    const action = resolveQuickSearchEscapeAction(createContext());

    expect(action).toBe('close-window');
  });
});