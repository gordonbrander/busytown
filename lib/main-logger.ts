import { fileJsonDriver, Logger } from "./logger.ts";

/** Top level logger */
export const logger = new Logger(
  {
    component: "busytown",
  },
  {
    driver: fileJsonDriver("busytown.log"),
  },
);

export default logger;
