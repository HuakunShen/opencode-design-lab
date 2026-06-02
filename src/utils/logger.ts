import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;
type LogInput = string | LogContext;
type LogMethod = (input: LogInput, message?: string) => void;

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const configuredLevel = parseLogLevel(process.env.LOG_LEVEL);

/**
 * Minimal dependency-free file logger for plugin startup safety.
 */
export const logger: Record<LogLevel, LogMethod> = {
  trace: createLogMethod("trace"),
  debug: createLogMethod("debug"),
  info: createLogMethod("info"),
  warn: createLogMethod("warn"),
  error: createLogMethod("error"),
};

function createLogMethod(level: LogLevel): LogMethod {
  return (input, message) => {
    if (LOG_LEVELS[level] < LOG_LEVELS[configuredLevel]) {
      return;
    }

    const text = typeof input === "string" ? input : (message ?? "");
    const context = typeof input === "string" ? undefined : input;
    appendLogLine(formatLogLine(level, text, context));
  };
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.toLowerCase();
  if (normalized && normalized in LOG_LEVELS) {
    return normalized as LogLevel;
  }
  return "info";
}

function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function appendLogLine(line: string): void {
  try {
    fs.mkdirSync(getLogDirectory(), { recursive: true });
    fs.appendFileSync(getLogPath(), `${line}\n`, "utf-8");
  } catch {
    // Logging must never prevent plugin startup.
  }
}

function formatLogLine(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
): string {
  const contextText = context ? ` ${stringifyContext(context)}` : "";
  return `[${formatTimestamp()}] ${LOG_LEVEL_NAMES[level]}: ${message}${contextText}`;
}

function stringifyContext(context: LogContext): string {
  try {
    return JSON.stringify(context, jsonReplacer);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ logContextError: error });
  }
}

function getLogDirectory(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "opencode",
    );
  }

  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "opencode",
  );
}

function getLogPath(): string {
  return path.join(getLogDirectory(), "design-lab.log");
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}
