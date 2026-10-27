import Homey from "homey";
import {ALARM_STATE} from "../../lib/JablotronClient";
import {DeviceData} from "../../types";
import type {Ja100} from "./driver";

export class AlarmDevice extends Homey.Device {
    static readonly CAPABILITY_HOMEALARM_STATE = 'homealarm_state';

    async onInit() {
        this.registerCapabilityListener(AlarmDevice.CAPABILITY_HOMEALARM_STATE, this.onHomeAlarmStateChanged.bind(this));
    }

    private async onHomeAlarmStateChanged(value: any, opts: any) {
        const data = <DeviceData>this.getData();

        if (!data["can-control"]) {
            throw Error(this.homey.__('error.cannotControl'));
        }

        let action: ALARM_STATE;
        if (value === 'armed') {
            action = ALARM_STATE.ARM;
        } else if (value === 'disarmed') {
            action = ALARM_STATE.DISARM;
        } else if (value === 'partially_armed') {
            if (!data["partial-arm-enabled"]) {
                throw Error(this.homey.__('error.partialArmNotEnabled'));
            }
            action = ALARM_STATE.PARTIAL_ARM;
        } else {
            this.error(`Unsupported action: ${value}`);

            throw Error(this.homey.__('error.unsupportedAction') + `: ${value}`);
        }

        return (<Ja100>this.driver).controlSection(
            {"component-id": data.id, "state": action},
            data["need-authorization"] !== false,
        )
            .catch((error) => {
                this.error(`Unable to change arming state: ${error}`);

                throw Error(this.homey.__('error.unableToChangeState') + ` ${error?.message ?? error}`);
            });
    }

    async updateState(state: string): Promise<boolean> {
        const deviceName = this.getName();
        const currentState = this.getCapabilityValue(AlarmDevice.CAPABILITY_HOMEALARM_STATE);

        if (currentState === state) {
            this.log(`[${deviceName}] state unchanged`);
            return false;
        }

        try {
            this.log(`[${deviceName}] state changed from ${currentState} state to ${state}`);
            await this.setCapabilityValue(AlarmDevice.CAPABILITY_HOMEALARM_STATE, state);

            // No notification for the first known state (fresh device / app start).
            if (currentState !== null && currentState !== undefined) {
                (<Ja100>this.driver).writeNotification(this.homey.__('notification.stateChanged', {
                    name: deviceName,
                    state: this.homey.__('modes.' + state).toLowerCase()
                }));
            }
        } catch (e) {
            this.error(`[${deviceName}] Unable to change state due to ` + e);

            return false;
        }

        return true;
    }
}

module.exports = AlarmDevice;
