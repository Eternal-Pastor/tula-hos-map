const loaders = new Map<string, Promise<any>>();
/** Один SDK для повторных монтирований; экземпляры карты принадлежат компоненту. */
export function loadYandex(
  key: string,
  namespace = "hospitalViewerMaps",
): Promise<any> {
  const id = namespace + ":" + key;
  const cached = loaders.get(id);
  if (cached) return cached;
  const promise = new Promise((resolve, reject) => {
    let script: HTMLScriptElement | undefined;
    let settled = false;
    const finish = (error?: Error, api?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (script) script.onload = script.onerror = null;
      if (error) {
        script?.remove();
        reject(error);
      } else resolve(api);
    };
    const timer = setTimeout(
      () => finish(new Error("Время ожидания карты истекло.")),
      20000,
    );
    const ready = (api: any) => {
      if (settled) return;
      try {
        api.ready(() => finish(undefined, api));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const existing = (window as unknown as Record<string, any>)[namespace];
    if (existing) {
      ready(existing);
      return;
    }
    script = document.createElement("script");
    script.src =
      "https://api-maps.yandex.ru/2.1/?" +
      new URLSearchParams({ apikey: key, lang: "ru_RU", ns: namespace });
    script.onload = () => {
      const api = (window as unknown as Record<string, any>)[namespace];
      api ? ready(api) : finish(new Error("API карты недоступен."));
    };
    script.onerror = () =>
      finish(
        new Error(
          "Не удалось подключить карту. Проверьте подключение к интернету.",
        ),
      );
    document.head.append(script);
  }).catch((error) => {
    loaders.delete(id);
    throw error;
  });
  loaders.set(id, promise);
  return promise;
}
