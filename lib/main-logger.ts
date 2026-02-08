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
    driver: multiDriver(consoleJsonDriver(), fileJsonDriver("busytown.log")),
  },
);

export default logger;
