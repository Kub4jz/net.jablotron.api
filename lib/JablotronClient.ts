import EventEmitter from "events";
import {CredentialsManager} from "./CredentialsManager";

export enum ALARM_STATE {
    ARM = 'ARM',
    PARTIAL_ARM = 'PARTIAL_ARM',
    DISARM = 'DISARM'
}

export interface ComponentState {
    "component-id": string,
    "state": ALARM_STATE
}

export interface CloudComponentState {
    "cloud-component-id": string,
    "state": ALARM_STATE
}

export interface Section {
    "cloud-component-id": string,
    "name": string,
    "can-control": boolean,
    "need-authorization": boolean,
    "partial-arm-enabled": boolean
}

export interface ComponentStates {
    data: { states: ComponentState[] }
}

export interface Sections {
    data: { states: CloudComponentState[], sections: Section[] }
}

const API_HOSTNAME = 'api.jablonet.net';
const API_URL = `https://${API_HOSTNAME}/api/2.2`;
const REQUEST_TIMEOUT_MS = 20000;
const SECRET_KEYS = ['password', 'authorization-code'];

// The Jablotron API is picky about headers - keep these as they are.
const HEADERS: Record<string, string> = {
    'x-vendor-id': 'JABLOTRON:Jablotron',
    'x-client-version': 'MYJ-PUB-ANDROID-15',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Accept-Encoding': '*',
    'Accept-Language': 'en',
    'Host': API_HOSTNAME,
};

export class JablotronClient extends EventEmitter {
    private readonly cookies = new Map<string, string>();
    private serviceId = 0;
    /** In-flight login shared by concurrent callers. */
    private authPromise: Promise<boolean> | null = null;

    constructor(private readonly credentialsManager: CredentialsManager) {
        super();
    }

    log(...props: any[]) {
        this.emit('log', ...props);
    }

    error(...props: any[]) {
        this.emit('error', ...props);
    }

    /** Log in and remember the service ID. Never throws. */
    async authorize(username: string, password: string): Promise<boolean> {
        try {
            const body = await this.parse(await this.send('/userAuthorize.json', {login: username, password}));
            const serviceId = body?.data?.['service-data']?.['service-detail']?.['service-id'];

            if (!serviceId) {
                throw Error('No service ID in response');
            }

            this.serviceId = serviceId;
            this.log('Authorized. Service ID: ' + serviceId);

            return true;
        } catch (e) {
            this.error('Authorization failed:', e);
            this.resetSession();

            return false;
        }
    }

    /** Drop the session so the next request logs in again with the stored credentials. */
    resetSession(): void {
        this.cookies.clear();
        this.serviceId = 0;
    }

    sections(): Promise<Sections> {
        return this.call('/sectionsGet.json', () => ({
            "connect-device": true,
            "list-type": "FULL",
            "service-id": this.serviceId,
            "service-states": true
        }));
    }

    /** @param pin Authorization code; omit for sections that do not need authorization. */
    controlSections(components: ComponentState[], pin?: string): Promise<ComponentStates> {
        components.forEach(c => this.log(`Changing section (${c["component-id"]}) state to ${c.state}`));

        return this.call('/controlComponent.json', () => ({
            "service-id": this.serviceId,
            ...(pin ? {"authorization": {"authorization-code": pin}} : {}),
            "control-components": components.map(c => ({
                "actions": {"action": "CONTROL-SECTION", "value": c.state},
                "component-id": c["component-id"],
                "force": false
            }))
        }));
    }

    /**
     * Authorized API call. On 401 logs in again and retries once.
     * The payload is a function so a retry picks up the new service ID.
     */
    private async call(endpoint: string, payload: () => object, retried = false): Promise<any> {
        if (this.serviceId === 0 && !(await this.login())) {
            throw Error('Unable to authorize');
        }

        const response = await this.send(endpoint, payload());

        if (response.status === 401 && !retried) {
            this.log('Unauthorized. Trying to reauthorize...');
            this.resetSession();

            return this.call(endpoint, payload, true);
        }

        return this.parse(response);
    }

    private login(): Promise<boolean> {
        if (this.authPromise === null) {
            const {username, password} = this.credentialsManager.get();

            this.authPromise = this.authorize(username, password)
                .finally(() => this.authPromise = null);
        }

        return this.authPromise;
    }

    private async send(endpoint: string, payload: object): Promise<Response> {
        this.log(`Calling ${endpoint} with body ${JSON.stringify(payload, (k, v) => SECRET_KEYS.includes(k) ? '***' : v)}`);

        const body = JSON.stringify(payload);
        const headers: Record<string, string> = {
            ...HEADERS,
            // Byte length, not character length (differs for non-ASCII, e.g. Czech diacritics).
            'Content-Length': Buffer.byteLength(body).toString(),
        };
        if (this.cookies.size > 0) {
            headers['Cookie'] = Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
        }

        const response = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        // Keep only name=value of each Set-Cookie (drop path, HttpOnly, ...).
        for (const setCookie of response.headers.getSetCookie()) {
            const [pair] = setCookie.split(';');
            const separator = pair.indexOf('=');
            if (separator > 0) {
                this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
            }
        }

        return response;
    }

    /** Parse the body and throw on HTTP or API errors. Tolerates non-JSON error bodies. */
    private async parse(response: Response): Promise<any> {
        const text = await response.text();
        let result: any;
        try {
            result = JSON.parse(text);
        } catch {
            result = text;
        }

        const message = result?.errors?.[0]?.message;

        if (!response.ok) {
            this.error('Communication problem.', 'Status code: ' + response.status, result);
            throw Error(message ? `Communication problem: ${message}` : `Communication problem (HTTP ${response.status}).`);
        }

        if (message !== undefined || typeof result !== 'object') {
            throw Error(message ?? 'Invalid response from Jablotron API');
        }

        return result;
    }
}
