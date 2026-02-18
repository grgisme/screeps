// ============================================================================
// Logger — Structured logging with lazy eval, throttling & delta alerts
// ============================================================================

/**
 * Log levels for filtering console output.
 * Higher value = more severe (ERROR=4 is always shown).
 * TRACE is the most verbose.
 */
export const LogLevel = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARNING: 3,
    ERROR: 4,
} as const;

export type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];

/** Message source: string or lazy function that avoids CPU cost when filtered. */
export type LogMessage = string | (() => string);

/** Emoji prefix for each log level. */
const LEVEL_EMOJI: Record<number, string> = {
    [LogLevel.TRACE]: "🔍",
    [LogLevel.DEBUG]: "🐛",
    [LogLevel.INFO]: "ℹ️",
    [LogLevel.WARNING]: "⚠️",
    [LogLevel.ERROR]: "🛑",
};

const LEVEL_LABELS: Record<number, string> = {
    [LogLevel.TRACE]: "TRACE",
    [LogLevel.DEBUG]: "DEBUG",
    [LogLevel.INFO]: "INFO",
    [LogLevel.WARNING]: "WARN",
    [LogLevel.ERROR]: "ERROR",
};

/**
 * Structured logger with:
 * - Level-based filtering (TRACE → ERROR)
 * - Lazy evaluation: pass `() => "expensive " + computation` to avoid CPU
 *   cost when the message would be filtered out
 * - Delta alerts: only log when a state value changes
 * - Modulo throttling: log periodic status updates every N ticks
 *
 * The current level is stored in `Memory.logLevel` so it persists across
 * global resets and can be changed at runtime from the Screeps console:
 *   setLogLevel('debug')
 */
export class Logger {
    /** The subsystem / module tag shown in brackets. */
    private tag: string;

    /**
     * Heap-cached previous values for delta alerting.
     * Key = alert id, Value = last logged value.
     */
    private static _deltaCache: Record<string, string> = {};

    constructor(tag: string) {
        this.tag = tag;
    }

    // -----------------------------------------------------------------------
    // Public API — each accepts string OR lazy () => string
    // -----------------------------------------------------------------------

    trace(msg: LogMessage): void {
        this.log(LogLevel.TRACE, msg);
    }

    debug(msg: LogMessage): void {
        this.log(LogLevel.DEBUG, msg);
    }

    info(msg: LogMessage): void {
        this.log(LogLevel.INFO, msg);
    }

    warning(msg: LogMessage): void {
        this.log(LogLevel.WARNING, msg);
    }

    warn(msg: LogMessage): void {
        this.log(LogLevel.WARNING, msg);
    }

    error(msg: LogMessage): void {
        this.log(LogLevel.ERROR, msg);
    }

    // -----------------------------------------------------------------------
    // Smart Logging — Delta Alerts & Modulo Throttling
    // -----------------------------------------------------------------------

    /**
     * Delta Alert — only logs if `value` changed since the last call
     * with the same `key`. Prevents repetitive spam for unchanged states.
     *
     * Example:
     *   log.alert("worker-state", "Harvesting");  // logs first time
     *   log.alert("worker-state", "Harvesting");  // suppressed (same)
     *   log.alert("worker-state", "Upgrading");   // logs (changed!)
     */
    alert(key: string, value: string, level: LogLevelType = LogLevel.INFO): void {
        const fullKey = `${this.tag}:${key}`;
        if (Logger._deltaCache[fullKey] === value) return; // No change
        Logger._deltaCache[fullKey] = value;
        this.log(level, `[Δ] ${key}: ${value}`);
    }

    /**
     * Modulo Throttle — only logs every `interval` ticks.
     * Uses optional `offset` (e.g. hash of source id) to stagger logs
     * across different entities so they don't all fire on the same tick.
     *
     * Example:
     *   log.throttle(100, () => `Site status: ${site.energy}`, site.id.charCodeAt(0));
     */
    throttle(interval: number, msg: LogMessage, offset: number = 0, level: LogLevelType = LogLevel.INFO): void {
        if ((Game.time + offset) % interval !== 0) return;
        this.log(level, msg);
    }

    // -----------------------------------------------------------------------
    // Core
    // -----------------------------------------------------------------------

    private log(level: LogLevelType, msg: LogMessage): void {
        if (level < Logger.getLevel()) {
            return;
        }

        // Lazy evaluation: only resolve the string now that we know it'll be printed
        const resolved = typeof msg === "function" ? msg() : msg;
        const emoji = LEVEL_EMOJI[level] ?? "";
        const label = LEVEL_LABELS[level] ?? "???";

        console.log(
            `${emoji} [${label}] [${this.tag}] ${resolved}`
        );
    }

    // -----------------------------------------------------------------------
    // Global Level Management
    // -----------------------------------------------------------------------

    /** Get the current effective log level. Defaults to INFO. */
    static getLevel(): LogLevelType {
        const stored = Memory.logLevel;
        if (stored !== undefined && stored >= LogLevel.TRACE && stored <= LogLevel.ERROR) {
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
            TRACE: LogLevel.TRACE,
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
                `❌ [Logger] Unknown level "${name}". Valid: TRACE, DEBUG, INFO, WARNING, ERROR`
            );
        }
    }

    /** Clear the delta cache (call on global reset if needed). */
    static resetDeltaCache(): void {
        Logger._deltaCache = {};
    }
}
