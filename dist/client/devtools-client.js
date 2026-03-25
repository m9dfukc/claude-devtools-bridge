// Browser-side WebSocket client that connects to the MCP devtools server
import { getRegisteredAtoms, getRegisteredActions, getLogs, clearLogs, } from "./action-registry";
import { safeSerializeValue } from "./safe-serialize";
const RECONNECT_INTERVAL_MS = 2000;
const DEFAULT_PORT = 7777;
const handleGetState = () => {
    const result = {};
    for (const [name, atom] of getRegisteredAtoms()) {
        result[name] = safeSerializeValue(atom.deref());
    }
    return result;
};
const parseValue = (value) => {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
};
const handleSetState = (path, value) => {
    const atoms = getRegisteredAtoms();
    const atom = atoms.get(path);
    if (!atom) {
        return {
            success: false,
            error: `Unknown atom "${path}". Available: ${[...atoms.keys()].join(", ")}`,
        };
    }
    atom.reset(parseValue(value));
    return { success: true };
};
const handleTriggerAction = async (name, payload) => {
    const actions = getRegisteredActions();
    const action = actions.get(name);
    if (!action) {
        return {
            success: false,
            error: `Unknown action "${name}". Available: ${[...actions.keys()].join(", ")}`,
        };
    }
    const result = payload !== undefined ? await action(payload) : await action();
    return { success: true, result: safeSerializeValue(result) };
};
const handleMessage = async (msg, send) => {
    switch (msg.type) {
        case "get_state":
            send({ type: "state_result", id: msg.id, data: handleGetState() });
            break;
        case "set_state": {
            const setResult = handleSetState(msg.path, msg.value);
            send({ type: "set_state_result", id: msg.id, ...setResult });
            break;
        }
        case "trigger_action": {
            const actionResult = await handleTriggerAction(msg.name, msg.payload);
            send({ type: "action_result", id: msg.id, ...actionResult });
            break;
        }
        case "get_logs":
            send({
                type: "logs_result",
                id: msg.id,
                data: safeSerializeValue(getLogs()),
            });
            break;
        case "clear_logs":
            clearLogs();
            send({ type: "clear_logs_result", id: msg.id, success: true });
            break;
    }
};
export const connectDevtools = (options) => {
    const port = options?.port ?? DEFAULT_PORT;
    let ws = null;
    let reconnectTimer = null;
    let disposed = false;
    const send = (data) => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    };
    const connect = () => {
        if (disposed)
            return;
        ws = new WebSocket(`ws://localhost:${port}`);
        ws.onopen = () => {
            console.log(`[devtools] connected to ws://localhost:${port}`);
        };
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleMessage(msg, send).catch((err) => {
                console.error("[devtools] error handling message:", err);
                if ("id" in msg) {
                    send({ type: "action_result", id: msg.id, success: false, error: String(err) });
                }
            });
        };
        ws.onclose = () => {
            console.log("[devtools] disconnected, reconnecting...");
            scheduleReconnect();
        };
        ws.onerror = () => {
            ws?.close();
        };
    };
    const scheduleReconnect = () => {
        if (disposed)
            return;
        reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL_MS);
    };
    const cleanup = () => {
        disposed = true;
        if (reconnectTimer)
            clearTimeout(reconnectTimer);
        ws?.close();
    };
    connect();
    return cleanup;
};
//# sourceMappingURL=devtools-client.js.map