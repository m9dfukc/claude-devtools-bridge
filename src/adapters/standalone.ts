// Standalone adapter — creates its own HTTP server for the relay

import { createStandaloneRelay, type Relay, type StandaloneRelayOptions } from "../relay/ws-relay.js";

export type { StandaloneRelayOptions } from "../relay/ws-relay.js";

export const startDevtoolsBridge = (port = 7777, options?: StandaloneRelayOptions): Relay =>
    createStandaloneRelay(port, options);
