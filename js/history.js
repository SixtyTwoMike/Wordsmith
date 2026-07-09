// A small bounded undo/redo stack. States are opaque strings (the editor
// serializes its blocks + caret position to JSON), so this module only
// deals with equality and pointer movement. One instance per editor; the
// editor resets it when a different script is loaded.

export function createHistory(limit = 100) {
  let stack = [];
  let ptr = -1;

  return {
    // Establish the baseline state (no undo past this point).
    reset(state) {
      stack = [state];
      ptr = 0;
    },
    // Record a new state. No-op if unchanged from the current one.
    // Truncates any redo branch and caps the stack at `limit`.
    push(state) {
      if (ptr >= 0 && stack[ptr] === state) return;
      stack = stack.slice(0, ptr + 1);
      stack.push(state);
      if (stack.length > limit) stack.shift();
      ptr = stack.length - 1;
    },
    undo() {
      if (ptr <= 0) return null;
      ptr--;
      return stack[ptr];
    },
    redo() {
      if (ptr >= stack.length - 1) return null;
      ptr++;
      return stack[ptr];
    },
    canUndo() {
      return ptr > 0;
    },
    canRedo() {
      return ptr < stack.length - 1;
    },
  };
}
