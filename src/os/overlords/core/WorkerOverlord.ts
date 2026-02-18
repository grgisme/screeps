import { Overlord } from "../Overlord";
import { Worker } from "../../zerg/Worker";

export class WorkerOverlord extends Overlord {
    workers: Worker[];

    constructor(colony: any) {
        super(colony, "worker");
        this.workers = (this as any).zergs.map((z: any) => new Worker(z.creep));
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
            this.workers.push(new Worker(orphan));
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
}
