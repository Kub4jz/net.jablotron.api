import {ALARM_STATE, CloudComponentState, ComponentState, JablotronClient} from "../../lib/JablotronClient";
import Homey from "homey";
import {CredentialsManager} from "../../lib/CredentialsManager";
import PairSession from "homey/lib/PairSession";
import {DeviceData, JaApp} from "../../types";
import {AlarmDevice} from "./device";

export class Ja100 extends Homey.Driver implements Ja100 {
    static readonly DEFAULT_POLLING_INTERVAL = 30;
    static readonly MIN_POLLING_INTERVAL = 15;

    private pollingInterval: number = Ja100.DEFAULT_POLLING_INTERVAL;
    private interval: any;
    private isSyncing: boolean = false;

    private client: JablotronClient | undefined;

    async onInit() {
        this.client = (<JaApp>this.homey.app).client;

        this.ready()
            .then(() => {
                this.pollingInterval = this.readPollingInterval();

                this.sync();
                this.schedule();
            });

        this.homey.settings.on('set', async (key) => {
            if (key === 'polling') {
                this.pollingInterval = this.readPollingInterval();
                this.schedule();
            }
        });

        this.homey.flow.getActionCard('force_sync')
            .registerRunListener(async (args: any, state: any) => {
                return await this.sync();
            });
    }

    async onPair(session: PairSession) {
        const credentials = (<JaApp>this.homey.app).credentials as CredentialsManager;

        session.setHandler('showView', async (view) => {
            if (view === 'login_credentials' && credentials.has()) {
                const stored = credentials.get();

                // Skip the login only if the stored credentials still work.
                if (await this.getClient().authorize(stored.username, stored.password)) {
                    this.log('Stored credentials are valid, skipping login.');
                    await session.showView('list_devices');
                } else {
                    this.log('Stored credentials are invalid, asking for new ones.');
                }
            }
        });

        session.setHandler("login", async (data) => this.login(data.username, data.password));

        session.setHandler("list_devices", async () => {
            const sections = await this.getClient().sections();

            return sections['data']['sections'].map((section) => {
                return {
                    name: section['name'],
                    data: <DeviceData>{
                        "id": section['cloud-component-id'],
                        "can-control": section['can-control'],
                        "need-authorization": section['need-authorization'],
                        "partial-arm-enabled": section['partial-arm-enabled'],
                    },
                };
            });
        });
    }

    async onRepair(session: PairSession, device: Homey.Device) {
        session.setHandler("login", async (data) => {
            const isValid = await this.login(data.username, data.password);

            if (isValid) {
                await this.sync();
                await session.done();
            }

            return isValid;
        });
    }

    async controlSection(control: ComponentState, needsAuthorization: boolean = true) {
        let pin: string | undefined;

        if (needsAuthorization) {
            pin = this.homey.settings.get('pin');

            if (pin === null || pin === undefined || pin === '') {
                this.error('No PIN defined. Cannot control arming state.');

                throw Error(this.homey.__('error.noPin'));
            }
        }

        return this.getClient().controlSections([control], pin)
            .then(states => {
                return states.data.states.map((state: ComponentState) => {
                    return <CloudComponentState>{
                        "cloud-component-id": state["component-id"],
                        state: state['state']
                    }
                })
            })
            .then((states: CloudComponentState[]) => this.updateComponentStates(states));
    }

    async sync() {
        const devices = <AlarmDevice[]>this.getDevices();

        if (devices.length === 0) {
            return true;
        }

        if (this.isSyncing) {
            this.log('Previous synchronization still running, skipping.');
            return true;
        }

        this.isSyncing = true;
        this.log('Synchronizing alarm states.');
        try {
            const sections = await this.getClient().sections();

            this.updateComponentStates(sections['data']['states']);

            return true;
        }
        catch (e) {
            this.error('Unable to sync states due to ' + e);

            devices.forEach(async (device: AlarmDevice) => {
                device.setUnavailable(this.homey.__('error.communication'));
            });

            return false
        }
        finally {
            this.isSyncing = false;
        }
    }

    private getClient(): JablotronClient {
        if (this.client === undefined) {
            throw Error(this.homey.__('error.notInitialized'));
        }

        return this.client;
    }

    private async login(username: string, password: string): Promise<boolean> {
        const isValid = await this.getClient().authorize(username, password);

        if (isValid) {
            const credentials = (<JaApp>this.homey.app).credentials as CredentialsManager;
            credentials.set(username, password);
        }

        return isValid;
    }

    private readPollingInterval(): number {
        const value = parseInt(this.homey.settings.get('polling'), 10);

        if (isNaN(value)) {
            return Ja100.DEFAULT_POLLING_INTERVAL;
        }

        return Math.max(Ja100.MIN_POLLING_INTERVAL, value);
    }

    private schedule() {
        if (this.interval) {
            this.log("Removing the existing interval");
            this.homey.clearInterval(this.interval);
        }

        this.log("Using an update interval of " + this.pollingInterval + " sec.");

        this.interval = this.homey.setInterval(this.sync.bind(this), this.pollingInterval * 1000);
    }

    private static toHomeyState(state: ALARM_STATE | undefined): string {
        switch (state) {
            case ALARM_STATE.ARM:
                return 'armed';
            case ALARM_STATE.PARTIAL_ARM:
                return 'partially_armed';
            default:
                return 'disarmed';
        }
    }

    private updateComponentStates(states: CloudComponentState[]) {
        const devices = <AlarmDevice[]>this.getDevices();

        if (devices.length === 0) {
            return;
        }

        let statesMap = new Map<string, CloudComponentState>();
        states.forEach((stateObj: any) => {
            statesMap.set(stateObj['cloud-component-id'], stateObj);
        });

        this.log('Updating states:', statesMap);

        devices.forEach(async (device: AlarmDevice) => {
            let deviceId = device.getData().id;
            const deviceName = device.getName();
            if (!statesMap.has(deviceId)) {
                this.log(`Device ${deviceName} state not found. Mark as unavailable.`);
                device.setUnavailable();

                return;
            }

            if (!device.getAvailable()) {
                await device.setAvailable();
            }

            try {
                const stateObj = statesMap.get(deviceId);
                const state = Ja100.toHomeyState(stateObj?.state);

                device.updateState(state);
            } catch (error) {
                this.error('Unable to update device state due to ' + error);
            }
        });
    }

    async writeNotification(message: string) {
        this.homey.notifications.createNotification({ excerpt: message })
            .then(() => {})
            .catch(() => {});
    }
}

module.exports = Ja100;
