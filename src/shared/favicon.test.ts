import { describe, expect, it } from 'vitest';
import { buildFaviconUrls } from './favicon';

describe('buildFaviconUrls', () => {
  it('should return browser favicon endpoint and site fallback for https url', () => {
    const urls = buildFaviconUrls('https://example.com/docs');

    expect(urls).toEqual([
      '/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs&size=32',
      'https://example.com/favicon.ico'
    ]);
  });

  it('should return empty list for non-http urls', () => {
    expect(buildFaviconUrls('about:config')).toEqual([]);
  });

  it('should return empty list for invalid url', () => {
    expect(buildFaviconUrls('not a url')).toEqual([]);
  });
});
