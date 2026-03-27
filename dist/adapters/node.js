// Generic Node HTTP adapter — mounts the devtools relay on any http.Server
import { createRelay } from "../relay/ws-relay.js";
export const mountDevtoolsBridge = (httpServer) => createRelay(httpServer);
//# sourceMappingURL=node.js.map