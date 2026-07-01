import { Client as SdkClient } from "@pochta-chat/sdk";
import type { ClientEvents, Identity } from "@pochta-chat/sdk";
import { store } from "./db";
import { httpBase } from "./server";
import { deviceId } from "./identity";

/**
 * Browser binding for the SDK client. Preserves the app's `new Client(url, id,
 * events)` call site while injecting the browser adapters the SDK needs: the
 * IndexedDB-backed `store`, this relay's http base, and a stable device id.
 */
export class Client extends SdkClient {
  constructor(url: string, identity: Identity, events: ClientEvents) {
    super({
      socketUrl: url,
      httpBase: httpBase(),
      identity,
      store,
      events,
      deviceId: deviceId(),
    });
  }
}

export type { CallState, PresenceInfo } from "@pochta-chat/sdk";
