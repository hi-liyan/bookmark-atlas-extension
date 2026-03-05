export interface QuickSearchEscapeContext {
  hasEditingDraft: boolean;
  hasDeletingItem: boolean;
  hasContextMenu: boolean;
}

export type QuickSearchEscapeAction =
  | 'close-edit-dialog'
  | 'close-delete-dialog'
  | 'close-context-menu'
  | 'close-window';

/**
 * 解析快捷搜索场景下 Esc 应执行的动作。
 * 入参：当前各层级弹层是否存在。
 * 出参：Esc 对应动作（按层级从高到低）。
 */
export const resolveQuickSearchEscapeAction = (
  context: QuickSearchEscapeContext
): QuickSearchEscapeAction => {
  if (context.hasEditingDraft) {
    return 'close-edit-dialog';
  }
  if (context.hasDeletingItem) {
    return 'close-delete-dialog';
  }
  if (context.hasContextMenu) {
    return 'close-context-menu';
  }
  return 'close-window';
};