export interface SingleFlightController<T> {
  run: () => Promise<T>;
  runFresh: () => Promise<T>;
}

/**
 * 构建单飞任务控制器：并发调用会复用同一个进行中的 Promise。
 * 入参：异步任务工厂函数。
 * 出参：包含 run / runFresh 的控制器。
 */
export const createSingleFlightController = <T>(
  taskFactory: () => Promise<T>
): SingleFlightController<T> => {
  let runningTask: Promise<T> | null = null;

  /**
   * 执行单飞任务：若已有执行中的任务则直接复用。
   * 入参：无。
   * 出参：任务执行结果 Promise。
   */
  const run = async (): Promise<T> => {
    if (runningTask) {
      return runningTask;
    }

    runningTask = taskFactory().finally(() => {
      runningTask = null;
    });
    return runningTask;
  };

  /**
   * 执行“强制新鲜”任务：若已有执行中的任务，先等待其结束，再启动一轮新任务。
   * 入参：无。
   * 出参：新一轮任务执行结果 Promise。
   */
  const runFresh = async (): Promise<T> => {
    if (runningTask) {
      try {
        await runningTask;
      } catch {
        // 前一轮失败不阻断本轮，继续尝试一次全新任务。
      }
    }
    return run();
  };

  return {
    run,
    runFresh
  };
};