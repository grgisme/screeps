
import { Overlord } from "../Overlord";
import { Colony } from "../../colony/Colony";
import { Logger } from "../../../utils/Logger";

const log = new Logger("TerminalOverlord");

export class TerminalOverlord extends Overlord {

    constructor(colony: Colony) {
        super(colony, "terminal");
    }

    init(): void {
        // No specific creep requirements for now, just structure management
        // Logic handled in run()
    }

    run(): void {
        if (!this.colony.room || !this.colony.room.terminal || !this.colony.room.storage) return;
        if (Game.time % 10 === 0) {
            this.handleBalancing();
        }
        this.handleMarketCalls();
    }

    private handleBalancing(): void {
        const terminal = this.colony.room.terminal;
        const storage = this.colony.room.storage;
        if (!terminal || !storage) return;

        if (terminal.cooldown > 0) return;

        const used = storage.store.getUsedCapacity(RESOURCE_ENERGY);
        const capacity = storage.store.getCapacity(RESOURCE_ENERGY);
        console.log(`Balancing check. Used: ${used}, Cap: ${capacity}, Ratio: ${used / capacity}`);

        if (used / capacity > 0.8) { // If we are rich (>80% storage), find a poor room (<20% storage)
            // Find a poor colony
            // NOTE: We need a way to see other colonies. 
            // We can look at Memory.colonies or just Game.rooms that are ours
            for (const roomName in Game.rooms) {
                if (roomName === this.colony.name) continue;
                const room = Game.rooms[roomName];
                if (room.controller && room.controller.my && room.storage) {
                    if (room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 200000) {
                        // Candidate found!
                        const amount = 5000;
                        const cost = Game.market.calcTransactionCost(amount, this.colony.name, roomName);

                        if (terminal.store.energy >= amount + cost) {
                            log.info(`[${this.colony.name}] Balancing: Sending ${amount} energy to ${roomName} (Cost: ${cost})`);
                            terminal.send(RESOURCE_ENERGY, amount, roomName);
                            return;
                        }
                    }
                }
            }
        }
    }

    private handleMarketCalls(): void {
        // If we are CRITICAL full (>900k), dump energy on the market
        const storage = this.colony.room.storage!;
        const terminal = this.colony.room.terminal!;

        if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > 900000) {
            // Check terminal energy
            if (terminal.store.energy >= 5000 && terminal.cooldown === 0) {
                // Find highest buy order
                const orders = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_ENERGY });
                // Simple filter: price > 0.01 (don't give it away for free unless desperate?)
                // Just find best price
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
                        log.info(`[${this.colony.name}] Market: Selling ${amount} energy at ${bestOrder.price} to ${bestOrder.roomName}`);
                        Game.market.deal(bestOrder.id, amount, this.colony.name);
                    }
                }
            }
        }
    }
}
