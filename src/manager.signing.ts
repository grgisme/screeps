export const managerSigning = {
    quotes: [
        "New Achievement! You've successfully landed in a sector where the AI has a foot fetish.",
        "God dammit Donut, I'm trying to optimize my spawn logic!",
        "Mongo is appalled by your lack of energy management.",
        "GLURP GLURP! - The sound of your energy being drained.",
        "You will not break me... but you might break my pathfinder.",
        "Princess Donut says: This room is unacceptable. Needs more glitter.",
        "The Butcher of Boros was here. And all he got was this lousy room.",
        "Treat the AI nicely. It's having a very difficult time with your spaghetti code.",
        "Attention Crawler: You are currently entering a zone of high pathing costs.",
        "This room is sponsored by the Boreas Corporation. Probably."
    ],

    /**
     * Signs the controller if it's not already signed or signed incorrectly.
     */
    run: function (creep: Creep) {
        const controller = creep.room.controller;
        if (!controller) return false;

        // Skip if signed by us and we don't feel like changing it (save CPU)
        if (controller.sign && controller.sign.text && this.quotes.includes(controller.sign.text)) {
            // Already signed with one of our quotes. 
            // Randomly change it 1% of the time?
            if (Math.random() > 0.01) return false;
        }

        const quote = this.quotes[Math.floor(Math.random() * this.quotes.length)];

        if (creep.signController(controller, quote) === ERR_NOT_IN_RANGE) {
            // Only move if we are VERY close (don't distract from main task)
            if (creep.pos.getRangeTo(controller) <= 1) {
                // Should already be in range if upgrader/builder is at work
            } else if (creep.memory.role === 'scout') {
                // Scouts can go out of their way a bit
                creep.moveTo(controller);
                return true;
            }
        }
        return false;
    }
};
