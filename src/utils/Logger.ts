// ============================================================================
// Logger — Structured logging with lazy eval, throttling, delta alerts,
//          safe HTML formatting, room links & XSS sanitization
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

/** Standard color palette for log levels (Screeps console HTML). */
const LEVEL_COLORS: Record<number, string> = {
    [LogLevel.TRACE]: "#8e8e8e",   // Grey
    [LogLevel.DEBUG]: "#3498db",   // Blue
    [LogLevel.INFO]: "#ffffff",    // White
    [LogLevel.WARNING]: "#f39c12", // Yellow/Orange
    [LogLevel.ERROR]: "#ff0000",   // Red
};

/**
 * Shard name for room links. Cached on first access.
 * Falls back to "shard3" if Game.shard is unavailable.
 */
function getShardName(): string {
    try {
        return (Game as any).shard?.name ?? "shard3";
    } catch {
        return "shard3";
    }
}

/**
 * Structured logger with:
 * - Level-based filtering (TRACE → ERROR)
 * - Lazy evaluation: pass `() => "expensive " + computation` to avoid CPU
 *   cost when the message would be filtered out
 * - Delta alerts: only log when a state value changes
 * - Modulo throttling: log periodic status updates every N ticks
 * - Safe HTML formatting with escaped double quotes
 * - Interactive room links
 * - XSS sanitization for hostile input
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
    // Formatting Helpers — Safe HTML for Screeps Console
    // -----------------------------------------------------------------------

    /**
     * Wrap text in a colored `<span>` using escaped double quotes.
     * This is the ONLY safe pattern for Screeps console HTML.
     *
     * Bad:  `<span style='color:red'>`   — parser may reject
     * Good: `<span style=\"color:red\">`  — always works
     *
     * @param text   The text to colorize
     * @param color  CSS color value (hex, named, rgb)
     */
    static style(text: string, color: string): string {
        return `<span style="color:${color}">${text}</span>`;
    }

    /**
     * Wrap text in a `<font>` tag for maximum terminal compatibility.
     * Some third-party Screeps clients only support `<font color="...">`.
     * Use this for critical alerts that must render everywhere.
     */
    static font(text: string, color: string): string {
        return `<font color="${color}">${text}</font>`;
    }

    /**
     * Generate a clickable room link for the Screeps console.
     * Clicking the link jumps the camera to the specified room.
     *
     * @param roomName  e.g. "E1N8"
     * @returns HTML anchor tag: `<a href="#!/room/shard3/E1N8">E1N8</a>`
     */
    static roomLink(roomName: string): string {
        const shard = getShardName();
        return `<a href="#!/room/${shard}/${roomName}">${roomName}</a>`;
    }

    /**
     * Sanitize untrusted input by escaping HTML entities.
     * Apply this to ANY data from hostile creeps, public memory segments,
     * or other players to prevent XSS-style client abuse.
     *
     * Replaces: < → &lt;  > → &gt;  & → &amp;  " → &quot;
     */
    static sanitize(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
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
        const color = LEVEL_COLORS[level] ?? "#ffffff";

        // Color-coded output: tag and label are styled, message body is styled
        const styledTag = `<span style="color:#999999">[${this.tag}]</span>`;
        const styledLabel = `<span style="color:${color}">[${label}]</span>`;
        const styledMsg = `<span style="color:${color}">${resolved}</span>`;

        console.log(`${emoji} ${styledLabel} ${styledTag} ${styledMsg}`);
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
