export const managerMarket = {
    run: function (room: Room) {
        if (Game.time % 100 !== 0) return; // Run rarely

        const terminal = room.terminal;
        if (!terminal || !terminal.my) return;

        // Auto-Sell Excess Energy
        const storage = room.storage;
        if (storage && storage.store[RESOURCE_ENERGY] > 500000 && terminal.store[RESOURCE_ENERGY] > 5000) {
            // Sell 5000 energy
            const amount = 5000;
            const orders = Game.market.getAllOrders(order => order.resourceType === RESOURCE_ENERGY &&
                order.type === ORDER_BUY &&
                order.amount >= amount &&
                order.price > 0.01); // Min price check

            if (orders.length > 0) {
                orders.sort((a, b) => b.price - a.price); // Highest price first
                // Check transfer cost?
                // For now, just execute
                Game.market.deal(orders[0].id, amount, room.name);
                console.log(`💰 MARKET: Sold ${amount} energy for ${orders[0].price} credits/u`);
            }
        }

        // Auto-Buy for Restart
        // Trigger: Room energy 0 (or very low) AND spawn acting?
        // Actually if room energy is 0, we can't spawn.
        // So if `room.energyAvailable < 300` and `creeps.length === 0`?
        // Requires Credits.
        if (room.energyAvailable === 0 && room.find(FIND_MY_CREEPS).length === 0) {
            // Buy 5000 energy
            if (terminal.store.getFreeCapacity() > 5000 && Game.market.credits > 1000) {
                const orders = Game.market.getAllOrders(order => order.resourceType === RESOURCE_ENERGY &&
                    order.type === ORDER_SELL &&
                    order.amount >= 5000 &&
                    order.price < 0.5); // Max price cap

                if (orders.length > 0) {
                    orders.sort((a, b) => a.price - b.price); // Cheapest first
                    Game.market.deal(orders[0].id, 5000, room.name);
                    console.log(`🆘 MARKET: Emergency bought 5000 energy for ${orders[0].price} credits/u`);
                }
            }
        }
    }
};
