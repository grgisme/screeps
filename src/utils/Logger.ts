// ============================================================================
// Logger — Structured logging with configurable verbosity
// ============================================================================

/**
 * Log levels for filtering console output.
 * Lower value = more verbose. Stored as plain constants.
 */
export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARNING: 2,
    ERROR: 3,
} as const;

export type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];

/** Emoji prefix for each log level. */
const LEVEL_EMOJI: Record<number, string> = {
    [LogLevel.DEBUG]: "🐛",
    [LogLevel.INFO]: "ℹ️",
    [LogLevel.WARNING]: "⚠️",
    [LogLevel.ERROR]: "❌",
};

const LEVEL_LABELS: Record<number, string> = {
    [LogLevel.DEBUG]: "DEBUG",
    [LogLevel.INFO]: "INFO",
    [LogLevel.WARNING]: "WARN",
    [LogLevel.ERROR]: "ERROR",
};

/**
 * Structured logger with level-based filtering.
 *
 * The current level is stored in `Memory.logLevel` so it persists across
 * global resets and can be changed at runtime from the Screeps console via
 * `setLogLevel('debug')`.
 */
export class Logger {
    /** The subsystem / module tag shown in brackets. */
    private tag: string;

    constructor(tag: string) {
        this.tag = tag;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    debug(msg: string): void {
        this.log(LogLevel.DEBUG, msg);
    }

    info(msg: string): void {
        this.log(LogLevel.INFO, msg);
    }

    warning(msg: string): void {
        this.log(LogLevel.WARNING, msg);
    }

    error(msg: string): void {
        this.log(LogLevel.ERROR, msg);
    }

    alert(msg: string): void {
        this.log(LogLevel.ERROR, `🚨 [ALERT] ${msg}`);
    }

    // -----------------------------------------------------------------------
    // Core
    // -----------------------------------------------------------------------

    private log(level: LogLevelType, msg: string): void {
        if (level < Logger.getLevel()) {
            return;
        }

        const emoji = LEVEL_EMOJI[level] ?? "";
        const label = LEVEL_LABELS[level] ?? "???";

        console.log(
            `${emoji} [${label}] [${this.tag}] ${msg}`
        );
    }

    // -----------------------------------------------------------------------
    // Global Level Management
    // -----------------------------------------------------------------------

    /** Get the current effective log level. Defaults to INFO. */
    static getLevel(): LogLevelType {
        const stored = Memory.logLevel;
        if (stored !== undefined && stored >= LogLevel.DEBUG && stored <= LogLevel.ERROR) {
            return stored as LogLevelType;
        }
        return LogLevel.INFO;
    }

    /** Set the global log level. Persists in Memory. */
    static setLevel(level: LogLevelType): void {
        Memory.logLevel = level;
    }

    /**
     * Parse a string level name and apply it.
     * Used by the `setLogLevel('debug')` console command.
     */
    static setLevelByName(name: string): void {
        const normalized = name.toUpperCase().trim();
        const map: Record<string, LogLevelType> = {
            DEBUG: LogLevel.DEBUG,
            INFO: LogLevel.INFO,
            WARNING: LogLevel.WARNING,
            WARN: LogLevel.WARNING,
            ERROR: LogLevel.ERROR,
        };
        const level = map[normalized];
        if (level !== undefined) {
            Logger.setLevel(level);
            console.log(
                `✅ [Logger] Log level set to ${normalized} (${level})`
            );
        } else {
            console.log(
                `❌ [Logger] Unknown level "${name}". Valid: DEBUG, INFO, WARNING, ERROR`
            );
        }
    }
}
