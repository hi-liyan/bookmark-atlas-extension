import { describe, expect, it } from 'vitest';
import { shouldApplyRemoteSnapshot } from './engine';

// 冲突策略测试：验证三种策略在本地/远端时间戳差异下的决策行为。
describe('shouldApplyRemoteSnapshot', () => {
  it('should apply remote when policy is prefer-remote', () => {
    expect(shouldApplyRemoteSnapshot('prefer-remote', 100, 500)).toBe(true);
  });

  it('should keep local when policy is prefer-local and local exists', () => {
    expect(shouldApplyRemoteSnapshot('prefer-local', 1000, 10)).toBe(false);
  });

  it('should accept remote for prefer-local when no local baseline exists', () => {
    expect(shouldApplyRemoteSnapshot('prefer-local', 1000, 0)).toBe(true);
  });

  it('should apply newer side for latest-write-wins', () => {
    expect(shouldApplyRemoteSnapshot('latest-write-wins', 200, 100)).toBe(true);
    expect(shouldApplyRemoteSnapshot('latest-write-wins', 100, 200)).toBe(false);
  });
});
