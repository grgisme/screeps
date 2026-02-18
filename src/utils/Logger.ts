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

/** Standard color palette — available for manual use with style(). */
export const LEVEL_COLORS: Record<number, string> = {
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
 * - Delta alerts: only log when a state value changes (with heap pruning)
 * - Modulo throttling: log periodic status updates every N ticks
 * - Safe HTML formatting with escaped double quotes
 * - Interactive room links
 * - XSS sanitization for hostile input
 *
 * V8 optimizations:
 * - Log level cached on heap to avoid hitting the Memory Proxy on every
 *   log evaluation. The cache is populated on first access and invalidated
 *   on setLevel/setLevelByName.
 * - Delta cache pruned at 1000 entries to prevent unbounded heap growth
 *   from dynamic keys (e.g., creep IDs).
 */
export class Logger {
    /** The subsystem / module tag shown in brackets. */
    private tag: string;

    /**
     * Heap-cached log level. Avoids hitting the Memory Proxy (which is a
     * V8 getter trap) on every log call across all processes. Populated
     * on first access, invalidated by setLevel/setLevelByName.
     */
    private static _cachedLevel?: LogLevelType;

    /**
     * Heap-cached previous values for delta alerting.
     * Key = alert id, Value = last logged value.
     * Uses Map instead of Record so `.size` is O(1) — avoids the
     * Object.keys() array allocation + GC spike on every alert() call.
     * Pruned when size exceeds 1000 entries to prevent unbounded growth.
     */
    private static _deltaCache: Map<string, string> = new Map();

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
     * The cache is pruned when it exceeds 1000 entries to prevent heap
     * leaks from dynamic keys (e.g., per-creep or per-structure IDs).
     *
     * Example:
     *   log.alert("worker-state", "Harvesting");  // logs first time
     *   log.alert("worker-state", "Harvesting");  // suppressed (same)
     *   log.alert("worker-state", "Upgrading");   // logs (changed!)
     */
    alert(key: string, value: string, level: LogLevelType = LogLevel.INFO): void {
        // Map.size is an O(1) property lookup — no array allocation.
        if (Logger._deltaCache.size > 1000) {
            Logger._deltaCache.clear();
        }

        const fullKey = `${this.tag}:${key}`;
        if (Logger._deltaCache.get(fullKey) === value) return; // No change
        Logger._deltaCache.set(fullKey, value);
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
     * Wrap text in a colored `<font>` tag.
     * Screeps console only supports `<font color="...">` — NOT `<span>`.
     *
     * @param text   The text to colorize
     * @param color  CSS color value (hex, named, rgb)
     */
    static style(text: string, color: string): string {
        return `<font color="${color}">${text}</font>`;
    }

    // Note: font() was removed — it was an exact duplicate of style().
    // All callers should use Logger.style() instead.

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

        // Plain text — Screeps console HTML rendering is unreliable
        console.log(`${emoji} [${label}] [${this.tag}] ${resolved}`);
    }

    // -----------------------------------------------------------------------
    // Global Level Management
    // -----------------------------------------------------------------------

    /**
     * Get the current effective log level. Defaults to INFO.
     *
     * Uses a heap-cached value to avoid hitting the Memory Proxy on every
     * log call. The cache is populated on the first access each global
     * lifecycle, and invalidated whenever setLevel/setLevelByName is called.
     */
    static getLevel(): LogLevelType {
        if (Logger._cachedLevel !== undefined) {
            return Logger._cachedLevel;
        }
        const stored = Memory.logLevel;
        if (stored !== undefined && stored >= LogLevel.TRACE && stored <= LogLevel.ERROR) {
            Logger._cachedLevel = stored as LogLevelType;
            return Logger._cachedLevel;
        }
        Logger._cachedLevel = LogLevel.INFO;
        return Logger._cachedLevel;
    }

    /**
     * Set the global log level. Persists in Memory and updates the
     * heap cache so subsequent getLevel() calls are instant.
     */
    static setLevel(level: LogLevelType): void {
        Memory.logLevel = level;
        Logger._cachedLevel = level;
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
        Logger._deltaCache.clear();
    }

    /** Clear the cached log level (forces re-read from Memory next call). */
    static resetLevelCache(): void {
        Logger._cachedLevel = undefined;
    }
}
