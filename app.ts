import sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

import Homey from 'homey';
import {JablotronClient} from './lib/JablotronClient';
import {CredentialsManager} from "./lib/CredentialsManager";

class JaApp extends Homey.App {
    public client: JablotronClient | undefined;
    public credentials: CredentialsManager | undefined;

    async onInit() {
        this.log('JaApp initialized...');

        this.credentials = new CredentialsManager(this.homey.settings, (...args) => this.error(...args));
        await this.credentials.init(await this.homey.cloud.getHomeyId());
        this.client = new JablotronClient(this.credentials);

        this.client.on('log', (...args) => this.log(...args));
        this.client.on('error', (...args) => this.error(...args));

        this.homey.settings.on('set', async key => {
            this.log('Settings change: ' + key);
            if (key === CredentialsManager.SETTINGS_USERNAME || key === CredentialsManager.SETTINGS_PASSWORD) {
                this.client?.resetSession();
            }
        });
    }
}

module.exports = JaApp;
