// Atom, derived, and action registration with execution log buffer + context stack
const LOG_BUFFER_LIMIT = 1000;
const registry = {
    atoms: new Map(),
    derived: new Map(),
    actions: new Map(),
    logs: [],
};
// --- Execution context stack (for nested action tree logging) ---
const executionStack = [];
export const pushExecutionContext = () => {
    executionStack.push([]);
};
export const popExecutionContext = () => {
    return executionStack.pop() ?? [];
};
export const currentExecutionDepth = () => executionStack.length;
// --- Atom registration ---
export const registerAtom = (name, atom) => {
    registry.atoms.set(name, atom);
    return () => registry.atoms.delete(name);
};
export const unregisterAtom = (name) => registry.atoms.delete(name);
export const getRegisteredAtoms = () => registry.atoms;
// --- Derived state registration ---
export const registerDerived = (name, derived) => {
    registry.derived.set(name, derived);
    return () => registry.derived.delete(name);
};
export const unregisterDerived = (name) => registry.derived.delete(name);
export const getRegisteredDerived = () => registry.derived;
// --- Action registration ---
export const registerAction = (name, fn) => {
    registry.actions.set(name, fn);
    return () => registry.actions.delete(name);
};
export const unregisterAction = (name) => registry.actions.delete(name);
export const getRegisteredActions = () => registry.actions;
// --- Log management ---
export const addLogEntry = (entry) => {
    // If inside a nested execution, add to parent's children collector
    if (executionStack.length > 0) {
        executionStack[executionStack.length - 1].push(entry);
    }
    else {
        registry.logs.push(entry);
        if (registry.logs.length > LOG_BUFFER_LIMIT) {
            registry.logs.splice(0, registry.logs.length - LOG_BUFFER_LIMIT);
        }
    }
};
export const getLogs = () => registry.logs;
export const clearLogs = () => {
    registry.logs.length = 0;
};
//# sourceMappingURL=action-registry.js.map