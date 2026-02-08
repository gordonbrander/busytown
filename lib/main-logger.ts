import {
  consoleJsonDriver,
  fileJsonDriver,
  Logger,
  multiDriver,
} from "./logger.ts";

/** Top level logger */
export const logger = new Logger(
  {
    component: "busytown",
  },
  {
    driver: multiDriver(consoleJsonDriver(), fileJsonDriver("logs")),
  },
);

export default logger;
