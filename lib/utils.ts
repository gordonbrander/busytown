/** Promise-based sleep utility. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Promise-based sleep utility that can be aborted. */
export const abortableSleep = (
  ms: number,
  signal: AbortSignal,
): Promise<void> => {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
};

/** Promise-based next tick utility. */
export const nextTick = () => new Promise((r) => setTimeout(r, 0));

/** Prints error message to stderr and exits with code 1. */
export const die = (msg: string): never => {
  console.error(msg);
  Deno.exit(1);
};

/** Never resolves */
export const forever = () => new Promise<void>(() => {});
