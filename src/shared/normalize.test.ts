import { describe, expect, it } from 'vitest';
import { normalizeText, normalizeUrl } from './normalize';

describe('normalize utilities', () => {
  it('normalizes title text', () => {
    expect(normalizeText('  Hello World  ')).toBe('hello world');
  });

  it('normalizes url by removing protocol and trailing slash', () => {
    expect(normalizeUrl('https://Example.com/path/')).toBe('example.com/path');
  });

  it('returns empty string for missing url', () => {
    expect(normalizeUrl(undefined)).toBe('');
  });
});
