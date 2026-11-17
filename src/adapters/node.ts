// Generic Node HTTP adapter — mounts the devtools relay on any http.Server

import type { Server as HttpServer } from "node:http";
import { createRelay, type Relay, type RelayOptions } from "../relay/ws-relay.js";

export type { RelayOptions } from "../relay/ws-relay.js";

export const mountDevtoolsBridge = (httpServer: HttpServer, options?: RelayOptions): Relay =>
    createRelay(httpServer, options);
