/**
 * PID file management utilities.
 * @module pid
 */

export const PID_FILE = ".runner.pid";

export async function readPid(): Promise<number | undefined> {
  try {
    const text = await Deno.readTextFile(PID_FILE);
    const pid = parseInt(text.trim(), 10);
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
}

export async function writePid(pid: number): Promise<void> {
  await Deno.writeTextFile(PID_FILE, String(pid) + "\n");
}

export async function removePid(): Promise<void> {
  try {
    await Deno.remove(PID_FILE);
  } catch {
    // ignore if already gone
  }
}

export async function isAlive(pid: number): Promise<boolean> {
  try {
    const cmd = new Deno.Command("kill", {
      args: ["-0", String(pid)],
      stderr: "null",
      stdout: "null",
    });
    const { success } = await cmd.output();
    return success;
  } catch {
    return false;
  }
}

/** Read PID file and check if process is alive. Cleans stale PID file. */
export async function getRunningPid(): Promise<number | undefined> {
  const pid = await readPid();
  if (pid == undefined) return undefined;
  if (await isAlive(pid)) return pid;
  await removePid();
  return undefined;
}
