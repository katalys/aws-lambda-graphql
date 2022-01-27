import { IEventStore } from "./types";

export class DummyEventHandler implements IEventStore {
    async publish(): Promise<void> {
        //todo
        throw new Error("not implemented");
    }
}
