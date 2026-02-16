/**
 * Inter-room signaling system.
 *
 * Provides a lightweight pub/sub mechanism for rooms to communicate
 * through Memory without tight coupling.
 *
 * Examples:
 *   - Room A signals "NEED_ENERGY" → Haulers from Room B respond
 *   - Room A signals "UNDER_ATTACK" → Defenders from neighboring rooms respond
 */

interface Signal {
    type: string;
    from: string;       // Room name
    data: any;
    tick: number;
    ttl: number;        // Ticks until expiry
}

export const commsSignals = {
    /**
     * Send a signal visible to all rooms.
     */
    send(roomName: string, type: string, data: any = {}, ttl: number = 50): void {
        if (!(Memory as any).signals) (Memory as any).signals = [];
        (Memory as any).signals.push({
            type,
            from: roomName,
            data,
            tick: Game.time,
            ttl,
        } as Signal);
    },

    /**
     * Read all active signals, optionally filtered by type.
     */
    read(type?: string): Signal[] {
        const signals: Signal[] = (Memory as any).signals || [];
        const active = signals.filter(s => s.tick + s.ttl > Game.time);

        // Garbage collect expired signals
        (Memory as any).signals = active;

        if (type) {
            return active.filter(s => s.type === type);
        }
        return active;
    },

    /**
     * Clear all signals from a specific room.
     */
    clearFrom(roomName: string): void {
        if (!(Memory as any).signals) return;
        (Memory as any).signals = ((Memory as any).signals as Signal[]).filter(s => s.from !== roomName);
    }
};
