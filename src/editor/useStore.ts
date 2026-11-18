import { useSyncExternalStore } from "react";
import type { Store } from "./store";

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Select a stable field, so unrelated summary updates do not rerender a control. */
export function useStoreField<T, R>(
  store: Store<T>,
  select: (value: T) => R,
): R {
  return useSyncExternalStore(store.subscribe, () =>
    select(store.getSnapshot()),
  );
}
