/** React captures the opener before portal autofocus; calculations never hold DOM nodes. */
const openers = new WeakMap();

/** @param {object} store @param {string} dialogId @param {HTMLElement|null} target @param {boolean} open */
export function rememberDialogOpener(store, dialogId, target, open) {
  if (open || !target || ["BODY", "HTML"].includes(target.tagName)) return;
  if (!openers.has(store)) openers.set(store, new Map());
  openers.get(store).set(dialogId, target);
}

/** @param {object} store @param {string} dialogId @param {HTMLElement|null} fallback */
export function restoreDialogFocus(store, dialogId, fallback) {
  const opener = openers.get(store)?.get(dialogId);
  openers.get(store)?.delete(dialogId);
  for (const target of [opener, fallback]) {
    if (
      !target?.isConnected ||
      target.closest("[hidden], [inert]") ||
      target.disabled
    )
      continue;
    target.focus();
    return true;
  }
  return false;
}

/** @param {object} store @param {string} dialogId */
export function hasDialogOpener(store, dialogId) {
  return Boolean(openers.get(store)?.has(dialogId));
}
