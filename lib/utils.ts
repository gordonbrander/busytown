/** Promise-based sleep utility. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Promise-based sleep utility that can be aborted. */
export const abortableSleep = (
  ms: number,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/** Prints error message to stderr and exits with code 1. */
export const die = (msg: string): never => {
  console.error(msg);
  Deno.exit(1);
};
