import {ALARM_STATE, CloudComponentState, ComponentState, JablotronClient} from "../../lib/JablotronClient";
import Homey from "homey";
import {CredentialsManager} from "../../lib/CredentialsManager";
import PairSession from "homey/lib/PairSession";
import {DeviceData, JaApp} from "../../types";
import {AlarmDevice} from "./device";

export class Ja100 extends Homey.Driver implements Ja100 {
    private pollingInterval: number = 30;
    private interval: any;

    private client: JablotronClient | undefined;

    async onInit() {
        this.ready()
            .then(() => {
                this.pollingInterval = this.homey.settings.get('polling') || 30;

                this.sync();
                this.schedule();
            });

        this.homey.settings.on('set', async (key) => {
            if (key === 'polling') {
                this.pollingInterval = this.homey.settings.get('polling');
                this.schedule();
            }
        });

        this.client = (<JaApp>this.homey.app).client;

        this.homey.flow.getActionCard('force_sync')
            .registerRunListener(async (args: any, state: any) => {
                return await this.sync();
            });
    }

    async onPair(session: PairSession) {
        let username = "";
        let password = "";

        const credentials = (<JaApp>this.homey.app).credentials as CredentialsManager;
        session.setHandler('showView', async (view) => {
            if (view === 'login_credentials') {
                if (credentials.has()) {
                    this.log('Credentials are set, skipping login.')
                    return session.showView('list_devices');
                }

                return session;
            }
        });

        session.setHandler("login", async (data) => {
            username = data.username;
            password = data.password;

            if (this.client === undefined) {
                throw Error('Client is not initialized.');
            }

            const isValid = await this.client.authorize(username, password);

            if (!isValid) {
                return isValid;
            }

            credentials.set(username, password);

            return isValid;
        });

        session.setHandler("list_devices", async () => {
            if (this.client === undefined) {
                throw Error('Client is not initialized.');
            }

            const sections = await this.client.sections();

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

    async controlSection(control: ComponentState) {
        if (this.client === undefined) {
            throw Error('Client is not initialized.');
        }

        const pin = this.homey.settings.get('pin');

        if (pin === null || pin === undefined || pin === '') {
            this.error(this.homey.__('error.noPinDefined'));

            throw Error('No PIN defined. Cannot control arming state.');
        }

        return this.client.controlSections([control], pin)
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

        this.log('Synchronizing alarm states.');
        const app = <JaApp>this.homey.app;
        const client = <JablotronClient>app.client;
        try {
            const sections = await client.sections();

            this.updateComponentStates(sections['data']['states']);

            return true;
        }
        catch (e) {
            this.error('Unable to sync states due to ' + e);

            devices.forEach(async (device: AlarmDevice) => {
                device.setUnavailable('Cannot communicate with Jablotron.');
            });

            return false
        }
    }

    private schedule() {
        if (this.interval) {
            this.log("Removing the existing interval");
            this.homey.clearInterval(this.interval);
        }

        this.log("Using an update interval of " + this.pollingInterval + " sec.");

        this.interval = this.homey.setInterval(this.sync.bind(this), this.pollingInterval * 1000);
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
                const state = stateObj?.state === ALARM_STATE.ARM ? 'armed' : 'disarmed';

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
