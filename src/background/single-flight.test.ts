import { createSingleFlightController } from './single-flight';

/**
 * 构造可延迟完成的 Promise，便于精确控制并发时序。
 * 入参：无。
 * 出参：包含 promise、resolve 与 reject 的对象。
 */
const createDeferred = <T>() => {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) {
        throw new Error('Deferred promise resolver is not initialized.');
      }
      resolvePromise(value);
    },
    reject(reason?: unknown): void {
      if (!rejectPromise) {
        throw new Error('Deferred promise rejector is not initialized.');
      }
      rejectPromise(reason);
    }
  };
};

describe('createSingleFlightController', () => {
  it('should share one in-flight task for concurrent run calls', async () => {
    const deferred = createDeferred<number>();
    const taskFactory = vi.fn(async () => deferred.promise);
    const controller = createSingleFlightController(taskFactory);

    const firstCall = controller.run();
    const secondCall = controller.run();

    expect(taskFactory).toHaveBeenCalledTimes(1);

    deferred.resolve(7);
    await expect(firstCall).resolves.toBe(7);
    await expect(secondCall).resolves.toBe(7);
  });

  it('should run a brand new task after runFresh waits current in-flight task', async () => {
    const firstDeferred = createDeferred<number>();
    const taskFactory = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(async () => firstDeferred.promise)
      .mockResolvedValueOnce(9);
    const controller = createSingleFlightController(taskFactory);

    const firstRun = controller.run();
    const freshRun = controller.runFresh();

    expect(taskFactory).toHaveBeenCalledTimes(1);

    firstDeferred.resolve(3);
    await expect(firstRun).resolves.toBe(3);
    await expect(freshRun).resolves.toBe(9);
    expect(taskFactory).toHaveBeenCalledTimes(2);
  });

  it('should still start new runFresh task when previous in-flight task failed', async () => {
    const failingDeferred = createDeferred<number>();
    const taskFactory = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(async () => failingDeferred.promise)
      .mockResolvedValueOnce(11);
    const controller = createSingleFlightController(taskFactory);

    const firstRun = controller.run();
    const freshRun = controller.runFresh();

    failingDeferred.reject(new Error('fail'));
    await expect(firstRun).rejects.toThrow('fail');
    await expect(freshRun).resolves.toBe(11);
    expect(taskFactory).toHaveBeenCalledTimes(2);
  });
});