/**
 * React hook for monitoring daemon process status.
 * @module tui/use-daemon-status
 */

import { useEffect, useRef, useState } from "react";
import { getRunningPid } from "../pid.ts";

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
}

export const useDaemonStatus = (pollMs = 5000): DaemonStatus => {
  const [status, setStatus] = useState<DaemonStatus>({ running: false });
  const startTimeRef = useRef<number | undefined>();
  const runningRef = useRef(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const pid = await getRunningPid();
        if (pid) {
          if (!runningRef.current) {
            startTimeRef.current = Date.now();
          }
          runningRef.current = true;
          const uptime = startTimeRef.current
            ? Math.floor((Date.now() - startTimeRef.current) / 1000)
            : 0;
          setStatus({ running: true, pid, uptime });
        } else {
          if (runningRef.current) {
            startTimeRef.current = undefined;
          }
          runningRef.current = false;
          setStatus({ running: false });
        }
      } catch (err) {
        console.error("Failed to check daemon status:", err);
      }
    };

    poll();
    const interval = setInterval(poll, pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);

  return status;
};
