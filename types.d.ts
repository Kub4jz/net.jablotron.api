import {JablotronClient} from "./lib/JablotronClient";
import {CredentialsManager} from "./lib/CredentialsManager";
import Homey from "homey";

declare class JaApp extends Homey.App {
    public client: JablotronClient | undefined;
    public credentials: CredentialsManager | undefined;
}

interface DeviceData {
    id: string,
    "can-control": boolean,
    "need-authorization": boolean,
    "partial-arm-enabled": boolean,
}
