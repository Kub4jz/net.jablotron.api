import EventEmitter from "events";
import {CredentialsManager} from "./CredentialsManager";

export enum ALARM_STATE {
    ARM = 'ARM',
    DISARM = 'DISARM'
}

export interface ComponentStates {
    data: {
        states: [ComponentState]
    }
}

export interface ComponentState {
    "component-id": string,
    "state": ALARM_STATE
}

export interface CloudComponentState {
    "cloud-component-id": string,
    "state": ALARM_STATE
}

export interface Sections {
    data: {
        states: [CloudComponentState],
        "sections": [{
            "cloud-component-id": string,
            "name": string,
            "can-control": boolean,
            "need-authorization": boolean,
            "partial-arm-enabled": boolean
        }]
    }
}

export class JablotronClient extends EventEmitter {
    static API_VERSION: string = '2.2';
    static API_HOSTNAME: string = 'api.jablonet.net';

    private readonly credentialsManager: CredentialsManager;
    private cookies: string | null = null;
    private readonly headers: {};
    private serviceId: number = 0;

    constructor(CredentialsManager: CredentialsManager) {
        super();

        this.credentialsManager = CredentialsManager;

        this.headers = {
            'x-vendor-id': 'JABLOTRON:Jablotron',
            'x-client-version': 'MYJ-PUB-ANDROID-15',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Accept-Encoding': '*',
            'Accept-Language': 'en',
            'Host': JablotronClient.API_HOSTNAME,
        };
    }

    log(...props: any[]) {
        this.emit('log', ...props);
    }

    error(...props: any[]) {
        this.emit('error', ...props);
    }

    async authorize(username: string, password: string): Promise<boolean> {
        try {
            const response = await this.doRequest('/userAuthorize.json', {
                'login': username,
                'password': password
            });

            if (!response.ok) {
                return false;
            }

            this.cookies = response.headers.get('set-cookie');

            this.log('Authorized.', 'Response cookies:', this.cookies);

            const body: any = await response.json();
            this.serviceId = body['data']['service-data']['service-detail']['service-id'];
            this.log('Service ID: ' + this.serviceId);

            return true;
        } catch (e) {
            return false;
        }
    }

    async sections(): Promise<Sections> {
        if (this.serviceId === 0) {
            await this.doAuthorize();
        }

        const response = await this.doRequest('/sectionsGet.json', {
            "connect-device": true,
            "list-type": "FULL",
            "service-id": this.serviceId,
            "service-states": true
        });

        return this.handleResponse(response);
    }

    async controlSections(components: ComponentState[], pin: string): Promise<ComponentStates> {
        if (this.serviceId === 0) {
            await this.doAuthorize();
        }

        components.forEach(component => this.log(`Changing section (${component["component-id"]}) state to ${component["state"]}`));

        const controlCmds = components.map(component => {
            return {
                "actions": {
                    "action": "CONTROL-SECTION",
                    "value": component["state"]
                },
                "component-id": component["component-id"],
                "force": false
            }
        }, components);

        const response = await this.doRequest('/controlComponent.json', {
            "service-id": this.serviceId,
            "authorization": {
                "authorization-code": pin
            },
            "control-components": controlCmds
        });

        return this.handleResponse(response);
    }

    private async doRequest(endpoint: string, payload: object): Promise<Response> {
        const url = 'https://' + JablotronClient.API_HOSTNAME + '/api/' + JablotronClient.API_VERSION + endpoint;

        this.log(`Calling ${endpoint} with body ${JSON.stringify(payload)}`);

        let headers: any = this.headers;
        if (this.cookies) {
            this.log('Using cookie', this.cookies);
            headers['Cookie'] = this.cookies;
        }

        const body = JSON.stringify(payload);
        headers['Content-Length'] = body.length;

        const options = {
            method: 'POST',
            timeout: 20000,
            headers: headers,
            body: body,
        };

        const response = await fetch(url, options);

        if (this.shouldReauthorize(response)) {
            this.log('Unauthorized. Trying to reauthorize...');
            if (!(await this.doAuthorize())) {
                this.error('Unable to authorize');

                throw Error('Unable to authorize');
            }

            // Retry the request with the new cookies
            return this.doRequest(endpoint, payload);
        }

        return response;
    }

    private doAuthorize(): Promise<boolean> {
        const credentials = this.credentialsManager.get();

        return this.authorize(credentials.username, credentials.password);
    }

    private shouldReauthorize(response: Response): boolean {
        return response.status === 401;
    }

    private async handleResponse(response: any) {
        if (!response.ok) {
            this.error('Communication problem.', 'Status code: ' + response.status);
            this.error(await response.json());
            throw Error('Communication problem.');
        }

        const result = await response.json();

        if (result['errors'] !== undefined) {
            throw Error(result['errors'][0]['message']);
        }

        return result;
    }
}
