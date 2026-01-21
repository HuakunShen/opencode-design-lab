import pino from "pino";
import * as path from "path";
import * as fs from "fs";

const logLevel = process.env.LOG_LEVEL || "info";

const levelNames: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function createLogStream() {
  const logPath = path.join(process.cwd(), "design-lab.log");
  const stream = fs.createWriteStream(logPath, { flags: "a" });

  return pino.multistream([
    {
      level: "trace",
      stream: {
        write: (chunk: string) => {
          try {
            const log = JSON.parse(chunk);
            const timestamp = formatTimestamp();
            const level = levelNames[log.level as number] || "UNKNOWN";
            const message = log.msg || "";
            stream.write(`[${timestamp}] ${level}: ${message}\n`);
          } catch (e) {
            stream.write(chunk + "\n");
          }
        },
      },
    },
  ]);
}

export const logger = pino(
  {
    level: logLevel,
    timestamp: false,
  },
  createLogStream(),
);
