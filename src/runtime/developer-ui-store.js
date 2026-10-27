/**
 * @typedef {Object} DeveloperField
 * @property {string} id
 * @property {string|number|undefined} value
 * @property {string|number|undefined} textContent
 * @property {boolean} checked
 * @property {boolean} hidden
 * @property {boolean} disabled
 * @property {boolean} open
 * @property {number} max
 * @property {number} focusVersion
 * @property {boolean} [complete]
 * @property {boolean} [error]
 * @property {boolean} [success]
 * @property {string} [aria-valuetext]
 * @property {((event:any)=>any)|null} [onclick]
 * @property {((event:any)=>any)|null} [onchange]
 * @property {((event:any)=>any)|null} [oninput]
 * @property {((event:any)=>any)|null} [onsubmit]
 * @property {()=>void} showModal
 * @property {()=>void} close
 * @property {()=>void} focus
 */
/** Headless view state. Only React renders controls; engines publish values and commands here. */
export function createDeveloperUI() {
  const listeners = new Set(),
    fields = new Map(),
    data = new Map();
  let revision = 0,
    queued = false,
    disposed = false;
  const changed = () => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) {
        revision++;
        for (const listener of listeners) listener();
      }
    });
  };
  const hidden = new Set([
    "table-view",
    "about-view",
    "detail-panel",
    "access-stop",
    "access-progress",
    "bulk-progress",
    "coverage-progress",
    "coverage-source",
    "stop-loading",
    "restart-zone-calculation",
    "access-legend",
    "zone-key",
    "backup-preview",
    "retry-cache",
    "toast",
  ]);
  const defaults = {
    "access-step": 5000,
    "map-color": "organization",
    metric: "per1000",
    "backup-mode": "merge",
    view: "map",
    "travel-mode": "auto",
  };
  /** @param {string} id @returns {DeveloperField} */
  function get(id) {
    if (!fields.has(id)) {
      const initial = {
        id,
        value: defaults[id] ?? "",
        textContent: undefined,
        checked: id === "show-zones",
        hidden: hidden.has(id),
        disabled: ["fit-map", "locate-all", "locate-all-addresses"].includes(
          id,
        ),
        open: false,
        max: 1,
        focusVersion: 0,
      };
      const commands = {};
      const field = new Proxy(initial, {
        get(target, key) {
          if (key === "showModal")
            return () => {
              field.open = true;
            };
          if (key === "close")
            return () => {
              field.open = false;
            };
          if (key === "focus")
            return () => {
              field.focusVersion++;
            };
          if (typeof key === "string" && key.startsWith("on"))
            return commands[key];
          return target[key];
        },
        set(target, key, value) {
          if (typeof key === "string" && key.startsWith("on")) {
            commands[key] = value;
            return true;
          }
          if (!Object.is(target[key], value)) {
            target[key] = value;
            changed();
          }
          return true;
        },
      });
      fields.set(id, field);
    }
    return fields.get(id);
  }
  return {
    get,
    setStatus(id, message, state = "info") {
      const field = get(id);
      field.error = state === "error";
      field.success = state === "success";
      field.textContent = message;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => revision,
    setData(id, value) {
      data.set(id, value);
      changed();
    },
    data: (id) => data.get(id),
    invoke(id, name = "click", event) {
      return get(id)["on" + name]?.(
        event ?? {
          target: get(id),
          currentTarget: get(id),
          preventDefault() {},
        },
      );
    },
    change(id, value, kind = "value") {
      get(id)[kind] = value;
      const event = {
        target: get(id),
        currentTarget: get(id),
        preventDefault() {},
      };
      get(id).oninput?.(event);
      return get(id).onchange?.(event);
    },
    clearCommands() {
      for (const field of fields.values())
        for (const name of ["onclick", "onchange", "oninput", "onsubmit"])
          field[name] = null;
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
