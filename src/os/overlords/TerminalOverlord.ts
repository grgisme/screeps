import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Logger } from "../../utils/Logger";
import { SEASON_MODE } from "../../main";

const log = new Logger("TerminalOverlord");

export class TerminalOverlord extends Overlord {
    constructor(colony: Colony) { super(colony, "terminal"); }
    init(): void { }

    run(): void {
        if (!this.colony.room || !this.colony.room.terminal || !this.colony.room.storage) return;

        // T2.2 — Season Mode gate: market is disabled in seasons.
        // Balancing (terminal.send between owned rooms) is always allowed.
        if (Game.time % 10 === 0) this.handleBalancing();
        if (!SEASON_MODE && Game.time % 100 === 0) this.handleMarketCalls();
    }

    private handleBalancing(): void {
        const terminal = this.colony.room?.terminal;
        const storage = this.colony.room?.storage;
        if (!terminal || !storage || terminal.cooldown > 0) return;

        const used = storage.store.getUsedCapacity(RESOURCE_ENERGY);
        const capacity = storage.store.getCapacity(RESOURCE_ENERGY);

        if (used / capacity > 0.8) {
            const myRooms = Object.values(Game.rooms).filter(r => r.controller?.my && r.storage);
            for (const room of myRooms) {
                if (room.name === this.colony.name) continue;
                if (room.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < 200000) {
                    const amount = 5000;

                    // T2.2 — calcTransactionCost is a market API call; guard in Season Mode.
                    // terminal.send() itself is always available (inter-room, not market).
                    const cost = SEASON_MODE ? 0 : Game.market.calcTransactionCost(amount, this.colony.name, room.name);
                    if (terminal.store.energy >= amount + cost) {
                        log.info(`[${this.colony.name}] Balancing: ${amount} to ${room.name} (Cost: ${cost})`);
                        terminal.send(RESOURCE_ENERGY, amount, room.name);
                        return;
                    }
                }
            }
        }
    }

    private handleMarketCalls(): void {
        // Called only when !SEASON_MODE (gated in run())
        const storage = this.colony.room?.storage;
        const terminal = this.colony.room?.terminal;
        if (!storage || !terminal || terminal.cooldown > 0) return;

        if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > 900000 && terminal.store.energy >= 5000) {
            const orders = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_ENERGY });
            let bestOrder = null;
            let maxPrice = -1;

            for (const order of orders) {
                if (order.price > maxPrice && order.amount > 0) {
                    maxPrice = order.price;
                    bestOrder = order;
                }
            }

            if (bestOrder) {
                const amount = Math.min(5000, bestOrder.amount);
                const cost = Game.market.calcTransactionCost(amount, this.colony.name, bestOrder.roomName!);
                if (terminal.store.energy >= amount + cost) {
                    log.info(`[${this.colony.name}] Market: Selling ${amount} at ${bestOrder.price} to ${bestOrder.roomName}`);
                    Game.market.deal(bestOrder.id, amount, this.colony.name);
                }
            }
        }
    }
}
