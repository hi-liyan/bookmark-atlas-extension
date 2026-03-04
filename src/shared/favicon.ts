/**
 * 为书签 URL 生成 favicon 候选地址列表。
 * 入参：rawUrl 书签原始 URL。
 * 出参：按优先级排序的 favicon URL 数组（可能为空）。
 */
export const buildFaviconUrls = (rawUrl?: string): string[] => {
  if (!rawUrl) {
    return [];
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return [];
    }

    const pageUrl = encodeURIComponent(parsedUrl.href);
    return [`/_favicon/?pageUrl=${pageUrl}&size=32`, `${parsedUrl.origin}/favicon.ico`];
  } catch {
    return [];
  }
};
