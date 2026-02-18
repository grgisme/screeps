import { Overlord } from "../Overlord";
import { Worker } from "../../zerg/Worker";

export class WorkerOverlord extends Overlord {
    workers: Worker[];

    constructor(colony: any) {
        super(colony, "worker");
        this.workers = (this as any).zergs.map((z: any) => {
            const w = new Worker(z.creep);
            w.overlord = this;
            return w;
        });
    }

    init(): void {
        this.adoptOrphans();
        this.handleSpawning();
    }

    run(): void {
        for (const worker of this.workers) {
            worker.run();
        }
    }

    private adoptOrphans(): void {
        const orphans = (this as any).colony.room.find(FIND_MY_CREEPS, {
            filter: (creep: Creep) => creep.memory.role === "worker" && !(this as any).colony.getZerg(creep.name)
        });

        for (const orphan of orphans) {
            const zerg = (this as any).colony.registerZerg(orphan);
            zerg.task = null;
            (this as any).zergs.push(zerg);
            const worker = new Worker(orphan);
            worker.overlord = this;
            this.workers.push(worker);
            console.log(`${(this as any).colony.name}: Adopted orphan worker ${orphan.name}`);
        }
    }

    private handleSpawning(): void {
        let target = 1;
        const sites = (this as any).colony.room.find(FIND_MY_CONSTRUCTION_SITES);
        const progressTotal = sites.reduce((sum: number, site: ConstructionSite) => sum + (site.progressTotal - site.progress), 0);

        if (progressTotal > 0) {
            target += Math.floor(progressTotal / 2000);
        }

        if (target > 5) target = 5;

        if (this.workers.length < target) {
            (this as any).colony.hatchery.enqueue({
                priority: 3,
                bodyTemplate: [WORK, CARRY, MOVE],
                overlord: this,
                memory: { role: "worker" }
            });
        }
    }
    getBestConstructionSite(): ConstructionSite | null {
        // Priority Table
        const priority: { [key in StructureConstant]?: number } = {
            [STRUCTURE_CONTAINER]: 0,
            [STRUCTURE_SPAWN]: 1,
            [STRUCTURE_EXTENSION]: 2,
            [STRUCTURE_TOWER]: 3,
            [STRUCTURE_ROAD]: 4,
            [STRUCTURE_STORAGE]: 5,
            [STRUCTURE_TERMINAL]: 5
        };

        const sites = (this as any).colony.room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[];
        if (sites.length === 0) return null;

        return sites.sort((a, b) => {
            const pA = priority[a.structureType] !== undefined ? priority[a.structureType]! : 10;
            const pB = priority[b.structureType] !== undefined ? priority[b.structureType]! : 10;

            if (pA !== pB) return pA - pB;

            // Tie-break: Completion progress (finish what's started)
            const progressA = a.progress / a.progressTotal;
            const progressB = b.progress / b.progressTotal;
            if (Math.abs(progressA - progressB) > 0.1) return progressB - progressA;

            return 0; // Distance can be handled by caller if needed, but for global priority we usually stick to type
        })[0];
    }
}
