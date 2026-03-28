// Browser-side WebSocket client that connects to the MCP devtools server
import { getRegisteredAtoms, getRegisteredDerived, getRegisteredActions, getLogs, clearLogs, } from "./action-registry";
import { safeSerializeValue } from "./safe-serialize";
const RECONNECT_INTERVAL_MS = 2000;
const DEFAULT_PORT = 5173;
const DEFAULT_PATH = "/devtools-bridge";
const handleGetState = () => {
    const atoms = {};
    for (const [name, atom] of getRegisteredAtoms()) {
        atoms[name] = safeSerializeValue(atom.deref());
    }
    const derivedMap = getRegisteredDerived();
    if (derivedMap.size === 0)
        return atoms;
    const derived = {};
    for (const [name, d] of derivedMap) {
        derived[name] = safeSerializeValue(d.deref());
    }
    return { ...atoms, $derived: derived };
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
    // Reject writes to derived state
    if (getRegisteredDerived().has(path)) {
        return {
            success: false,
            error: `"${path}" is a derived (read-only) value and cannot be set directly.`,
        };
    }
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
    const path = options?.path ?? DEFAULT_PATH;
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
        ws = new WebSocket(`ws://localhost:${port}${path}?role=browser`);
        ws.onopen = () => {
            console.log(`[Devtools Bridge] connected to ws://localhost:${port}${path}`);
        };
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleMessage(msg, send).catch((err) => {
                console.error("[Devtools Bridge] error handling message:", err);
                if ("id" in msg) {
                    send({ type: "action_result", id: msg.id, success: false, error: String(err) });
                }
            });
        };
        ws.onclose = () => {
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