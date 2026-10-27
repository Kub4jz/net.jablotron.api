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

        this.credentials = new CredentialsManager(this.homey.settings);
        this.client = new JablotronClient(this.credentials);

        this.client.on('log', (...args) => this.log(...args));
        this.client.on('error', (...args) => this.error(...args));

        this.homey.settings.on('set', async key => {
            this.log('Settings change: ' + key);
            if (key === 'username' || key === 'password') {
                this.client?.resetSession();
            }
        });
    }
}

module.exports = JaApp;
