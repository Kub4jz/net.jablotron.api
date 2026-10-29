import {ComponentState} from "./JablotronClient";

interface Batch<T> {
    /** Keyed by component ID - the last command for a section wins. */
    controls: Map<string, ComponentState>;
    /** True when at least one section in the batch needs authorization. */
    needsAuthorization: boolean;
    result: Promise<T>;
}

/**
 * Collects section control commands for a short window and sends them as one request.
 * The window starts with the first command and is not extended by later ones,
 * so a command waits at most `windowMs`.
 * Every caller in the same batch gets the same promise (one request, one result).
 */
export class SectionControlBatcher<T> {
    private pending: Batch<T> | null = null;

    constructor(
        private readonly send: (controls: ComponentState[], needsAuthorization: boolean) => Promise<T>,
        private readonly delay: (ms: number) => Promise<void>,
        private readonly windowMs = 200,
    ) {}

    control(control: ComponentState, needsAuthorization: boolean): Promise<T> {
        if (this.pending === null) {
            const batch = <Batch<T>>{controls: new Map(), needsAuthorization: false};

            batch.result = this.delay(this.windowMs).then(() => {
                // Commands arriving from now on start a new batch.
                this.pending = null;

                return this.send([...batch.controls.values()], batch.needsAuthorization);
            });

            this.pending = batch;
        }

        this.pending.controls.set(control["component-id"], control);
        this.pending.needsAuthorization ||= needsAuthorization;

        return this.pending.result;
    }
}
