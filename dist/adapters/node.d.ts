import type { Server as HttpServer } from "node:http";
import { type Relay, type RelayOptions } from "../relay/ws-relay.js";
export type { RelayOptions } from "../relay/ws-relay.js";
export declare const mountDevtoolsBridge: (httpServer: HttpServer, options?: RelayOptions) => Relay;
