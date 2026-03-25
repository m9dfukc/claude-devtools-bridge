// Atom and action registration with execution log buffer
const LOG_BUFFER_LIMIT = 1000;
const registry = {
    atoms: new Map(),
    actions: new Map(),
    logs: [],
};
export const registerAtom = (name, atom) => {
    registry.atoms.set(name, atom);
};
export const registerAction = (name, fn) => {
    registry.actions.set(name, fn);
};
export const getRegisteredAtoms = () => registry.atoms;
export const getRegisteredActions = () => registry.actions;
export const addLogEntry = (entry) => {
    registry.logs.push(entry);
    if (registry.logs.length > LOG_BUFFER_LIMIT) {
        registry.logs.splice(0, registry.logs.length - LOG_BUFFER_LIMIT);
    }
};
export const getLogs = () => registry.logs;
export const clearLogs = () => {
    registry.logs.length = 0;
};
//# sourceMappingURL=action-registry.js.map