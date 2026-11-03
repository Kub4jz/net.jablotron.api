import {JaApp} from "./types";

/**
 * Web API used by the settings page. Secrets never leave the app: the page only learns
 * whether a password / PIN is set and sends new values, which are encrypted here.
 */
module.exports = {
    async getSettings({homey}: { homey: any }) {
        const credentials = (<JaApp>homey.app).credentials!;

        return {
            username: homey.settings.get('username') ?? '',
            polling: homey.settings.get('polling') ?? '30',
            hasPassword: credentials.hasPassword(),
            hasPin: credentials.hasPin(),
        };
    },

    async updateSettings({homey, body}: { homey: any, body: any }) {
        const credentials = (<JaApp>homey.app).credentials!;

        if (typeof body.username === 'string') {
            homey.settings.set('username', body.username);
        }

        // Empty fields mean "keep the stored value".
        if (typeof body.password === 'string' && body.password !== '') {
            credentials.set(body.username ?? homey.settings.get('username'), body.password);
        }

        if (body.clearPin === true) {
            credentials.setPin('');
        } else if (typeof body.pin === 'string' && body.pin !== '') {
            credentials.setPin(body.pin);
        }

        if (body.polling !== undefined) {
            homey.settings.set('polling', String(body.polling));
        }

        return true;
    },
};
