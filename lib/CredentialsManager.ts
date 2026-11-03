import crypto from 'crypto';
import ManagerSettings from "homey/manager/settings";
import {SecretBox} from "./SecretBox";

/**
 * Keeps the MyJablotron credentials and the alarm PIN in Homey settings.
 *
 * Password and PIN are stored encrypted. The key is derived from the Homey ID and a random
 * salt generated on first start.
 * Note: this protects data at rest, not against someone with full access to this Homey.
 */
export class CredentialsManager {
    static SETTINGS_USERNAME = 'username';
    static SETTINGS_PASSWORD = 'password';
    static SETTINGS_PIN = 'pin';
    static SETTINGS_SALT = 'secret-salt';

    private static readonly KEY_CONTEXT = 'net.jablotron.api:credentials:';

    private box: SecretBox | undefined;

    constructor(
        private readonly settings: ManagerSettings,
        private readonly onError: (...args: any[]) => void = () => {},
    ) {
    }

    /** Must be awaited before any other method is used. */
    async init(homeyId: string) {
        this.box = SecretBox.create(CredentialsManager.KEY_CONTEXT + homeyId, this.getOrCreateSalt());
    }

    set(username: string, password: string) {
        this.settings.set(CredentialsManager.SETTINGS_USERNAME, username);
        this.writeSecret(CredentialsManager.SETTINGS_PASSWORD, password);
    }

    get(): { "username": string, "password": string } {
        return {
            "username": this.settings.get(CredentialsManager.SETTINGS_USERNAME),
            "password": this.readSecret(CredentialsManager.SETTINGS_PASSWORD) ?? '',
        };
    }

    has(): boolean {
        const settingsKeys = this.settings.getKeys();

        return settingsKeys.includes(CredentialsManager.SETTINGS_USERNAME) && this.hasPassword();
    }

    hasPassword(): boolean {
        return this.readSecret(CredentialsManager.SETTINGS_PASSWORD) !== null;
    }

    setPin(pin: string) {
        this.writeSecret(CredentialsManager.SETTINGS_PIN, pin);
    }

    getPin(): string | null {
        return this.readSecret(CredentialsManager.SETTINGS_PIN);
    }

    hasPin(): boolean {
        return this.getPin() !== null;
    }

    private writeSecret(key: string, value: string) {
        if (value === '') {
            this.settings.unset(key);
            return;
        }

        this.settings.set(key, this.getBox().encrypt(value));
    }

    /** Returns null when the value is missing or cannot be decrypted (e.g. backup restored on another Homey). */
    private readSecret(key: string): string | null {
        const value = this.settings.get(key);

        if (value === null || value === undefined || value === '') {
            return null;
        }

        try {
            return this.getBox().decrypt(value);
        } catch (e) {
            this.onError(`Unable to decrypt setting "${key}", it has to be entered again.`);
            return null;
        }
    }

    private getOrCreateSalt(): Buffer {
        let salt = this.settings.get(CredentialsManager.SETTINGS_SALT);

        if (typeof salt !== 'string' || salt === '') {
            salt = crypto.randomBytes(16).toString('hex');
            this.settings.set(CredentialsManager.SETTINGS_SALT, salt);
        }

        return Buffer.from(salt, 'hex');
    }

    private getBox(): SecretBox {
        if (this.box === undefined) {
            throw new Error('CredentialsManager is not initialized.');
        }

        return this.box;
    }
}
