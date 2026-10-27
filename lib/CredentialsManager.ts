import ManagerSettings from "homey/manager/settings";

export class CredentialsManager {
    static SETTINGS_USERNAME = 'username';
    static SETTINGS_PASSWORD = 'password';

    settings: ManagerSettings;

    constructor(settings: ManagerSettings) {
        this.settings = settings;
    }

    set(username: string, password: string) {
        this.settings.set(CredentialsManager.SETTINGS_USERNAME, username);
        this.settings.set(CredentialsManager.SETTINGS_PASSWORD, password);
    }

    get(): { "username": string, "password": string } {
        return {
            "username": this.settings.get(CredentialsManager.SETTINGS_USERNAME),
            "password": this.settings.get(CredentialsManager.SETTINGS_PASSWORD),
        };
    }

    has(): boolean {
        const settingsKeys = this.settings.getKeys();

        return settingsKeys.includes(CredentialsManager.SETTINGS_USERNAME) && settingsKeys.includes(CredentialsManager.SETTINGS_PASSWORD);
    }

    refresh(): void {
        this.set(
            this.settings.get(CredentialsManager.SETTINGS_USERNAME),
            this.settings.get(CredentialsManager.SETTINGS_PASSWORD),
        )
    }
}
