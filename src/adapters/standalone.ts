// Standalone adapter — creates its own HTTP server for the relay

import { createStandaloneRelay } from "../relay/ws-relay.js";

export const startDevtoolsBridge = (port = 7777): { close(): void } =>
    createStandaloneRelay(port);
