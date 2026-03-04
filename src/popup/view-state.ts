import { ROOT_FOLDER_ID } from './view-model';

export const POPUP_VIEW_STATE_KEY = 'popup-view-state';

export interface PopupViewStateSnapshot {
  query: string;
  selectedFolderId: string;
  expandedFolderIds: string[];
}

/**
 * 校验任意输入是否为合法的 popup 视图快照结构。
 * 入参：未知类型的原始值。
 * 出参：是否满足 PopupViewStateSnapshot 类型。
 */
export const isPopupViewStateSnapshot = (value: unknown): value is PopupViewStateSnapshot => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PopupViewStateSnapshot>;
  if (typeof candidate.query !== 'string' || typeof candidate.selectedFolderId !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.expandedFolderIds)) {
    return false;
  }

  return candidate.expandedFolderIds.every((folderId) => typeof folderId === 'string');
};

/**
 * 清洗 popup 视图快照，剔除失效目录并回退非法选中目录。
 * 入参：原始快照、当前可用目录 id 集合。
 * 出参：可安全用于界面恢复与存储的快照。
 */
export const sanitizePopupViewStateSnapshot = (
  snapshot: PopupViewStateSnapshot,
  validFolderIds: Set<string>
): PopupViewStateSnapshot => {
  const selectedFolderId =
    snapshot.selectedFolderId === ROOT_FOLDER_ID || validFolderIds.has(snapshot.selectedFolderId)
      ? snapshot.selectedFolderId
      : ROOT_FOLDER_ID;

  const expandedFolderIds: string[] = [];
  const seenFolderIds = new Set<string>();
  snapshot.expandedFolderIds.forEach((folderId) => {
    // 仅保留当前目录树中存在的目录，并去重保证存储结构稳定。
    if (validFolderIds.has(folderId) && !seenFolderIds.has(folderId)) {
      expandedFolderIds.push(folderId);
      seenFolderIds.add(folderId);
    }
  });

  return {
    query: snapshot.query,
    selectedFolderId,
    expandedFolderIds
  };
};
