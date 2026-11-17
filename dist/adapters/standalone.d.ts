import { type Relay, type StandaloneRelayOptions } from "../relay/ws-relay.js";
export type { StandaloneRelayOptions } from "../relay/ws-relay.js";
export declare const startDevtoolsBridge: (port?: number, options?: StandaloneRelayOptions) => Relay;
