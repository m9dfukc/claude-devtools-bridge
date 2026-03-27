// Generic Node HTTP adapter — mounts the devtools relay on any http.Server

import type { Server as HttpServer } from "node:http";
import { createRelay } from "../relay/ws-relay.js";

export const mountDevtoolsBridge = (httpServer: HttpServer): { close(): void } =>
    createRelay(httpServer);
