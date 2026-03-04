import { useEffect, useMemo, useState } from 'react';
import { buildFaviconUrls } from '../shared/favicon';

interface BookmarkFaviconProps {
  url?: string;
  title?: string;
  sizeClassName?: string;
}

/**
 * 渲染书签 favicon，并在加载失败时自动回退到下一个候选地址。
 * 入参：书签 URL、标题以及尺寸样式类名。
 * 出参：React 元素。
 */
export const BookmarkFavicon = ({ url, title, sizeClassName = 'h-5 w-5' }: BookmarkFaviconProps) => {
  const faviconUrls = useMemo(() => buildFaviconUrls(url), [url]);
  const [activeUrlIndex, setActiveUrlIndex] = useState(0);

  useEffect(() => {
    setActiveUrlIndex(0);
  }, [url]);

  const currentFaviconUrl = faviconUrls[activeUrlIndex];
  const showFallback = !currentFaviconUrl;
  const fallbackLabel = (title || '?').trim().charAt(0).toUpperCase() || '?';

  if (showFallback) {
    return (
      // favicon 兜底占位：当 URL 不可用或所有候选失败时显示首字母。
      <span
        aria-hidden
        className={`${sizeClassName} inline-flex shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] font-semibold text-slate-600`}
      >
        {fallbackLabel}
      </span>
    );
  }

  return (
    // favicon 图片：优先显示真实站点图标，失败时切换下一候选地址。
    <img
      alt=""
      aria-hidden
      className={`${sizeClassName} shrink-0 rounded`}
      loading="lazy"
      src={currentFaviconUrl}
      onError={() => {
        setActiveUrlIndex((previous) => previous + 1);
      }}
    />
  );
};
