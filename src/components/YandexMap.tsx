import { useLayoutEffect, useRef } from "react";

// Только эта граница знает API Яндекса; его объекты не попадают в React state.
export interface YandexMapHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(api: any, state: any, options?: any): any;
  destroy(): void;
  onDestroy?(callback: () => void): () => void;
}
interface Props {
  id?: string;
  className?: string;
  ariaLabel?: string;
  onHostReady?: (host: YandexMapHost | null) => void;
  onMount?: (element: HTMLDivElement) => void | (() => void);
}
export function YandexMap({
  id = "map",
  className,
  ariaLabel,
  onHostReady,
  onMount,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let instance: { destroy(): void } | null = null;
    const cleanup = new Set<() => void>();
    let alive = true;
    const host: YandexMapHost = {
      create(api, state, options) {
        if (!alive) throw new DOMException("Карта закрыта", "AbortError");
        host.destroy();
        instance = new api.Map(ref.current, state, options);
        return instance;
      },
      onDestroy(callback) {
        cleanup.add(callback);
        return () => {
          cleanup.delete(callback);
        };
      },
      destroy() {
        cleanup.forEach((callback) => callback());
        instance?.destroy();
        instance = null;
      },
    };
    const dispose = onMount?.(ref.current!);
    onHostReady?.(host);
    return () => {
      alive = false;
      onHostReady?.(null);
      dispose?.();
      host.destroy();
    };
  }, [onHostReady, onMount]);
  return <div ref={ref} id={id} className={className} aria-label={ariaLabel} />;
}
