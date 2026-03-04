import { browser } from '../shared/browser';
import {
  isPopupViewStateSnapshot,
  POPUP_VIEW_STATE_KEY,
  type PopupViewStateSnapshot
} from './view-state';

/**
 * 从浏览器本地存储读取 popup 上次视图状态。
 * 入参：无。
 * 出参：合法快照返回对象，异常或无效数据返回 null。
 */
export const loadPopupViewState = async (): Promise<PopupViewStateSnapshot | null> => {
  try {
    const stored = await browser.storage.local.get(POPUP_VIEW_STATE_KEY);
    const value = stored[POPUP_VIEW_STATE_KEY];
    if (!isPopupViewStateSnapshot(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

/**
 * 持久化 popup 当前视图状态到浏览器本地存储。
 * 入参：待保存的快照。
 * 出参：Promise<void>，仅表示写入流程完成。
 */
export const savePopupViewState = async (snapshot: PopupViewStateSnapshot): Promise<void> => {
  await browser.storage.local.set({
    [POPUP_VIEW_STATE_KEY]: snapshot
  });
};
