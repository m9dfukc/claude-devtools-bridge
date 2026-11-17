import type { Plugin } from "vite";
import { type RelayOptions } from "../relay/ws-relay.js";
export type { RelayOptions } from "../relay/ws-relay.js";
export declare const devtoolsBridgePlugin: (options?: RelayOptions) => Plugin;
