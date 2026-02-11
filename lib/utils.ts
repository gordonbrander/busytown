/** Promise-based sleep utility. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Prints error message to stderr and exits with code 1. */
export const die = (msg: string): never => {
  console.error(msg);
  Deno.exit(1);
};

/** Never resolves */
export const forever = () => new Promise<void>(() => {});
