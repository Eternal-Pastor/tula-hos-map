let namespaceSequence = 0;

/** Load one SDK namespace, tied to the lifetime of the mounted workspace. */
export function loadDeveloperYandex(key, signal) {
  return new Promise((resolve, reject) => {
    const namespace = `hospitalYmaps${Date.now()}_${++namespaceSequence}`;
    const script = document.createElement('script');
    let settled = false;
    let timer;
    const dispose = () => {
      script.onload = null;
      script.onerror = null;
      script.remove();
      delete window[namespace];
    };
    const finish = (error, api) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) { dispose(); reject(error); }
      else resolve({ api, dispose });
    };
    const abort = () => finish(new DOMException('Подключение остановлено', 'AbortError'));
    timer = setTimeout(() => finish(new Error('Время ожидания ответа Яндекса истекло.')), 20000);
    script.src = 'https://api-maps.yandex.ru/2.1/?' + new URLSearchParams({ apikey: key, lang: 'ru_RU', ns: namespace });
    script.onerror = () => finish(new Error('Не удалось загрузить API. Проверьте сеть и ключ.'));
    script.onload = () => {
      const api = window[namespace];
      if (!api) return finish(new Error('API не инициализирован.'));
      api.ready(() => finish(null, api));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    document.head.append(script);
  });
}
