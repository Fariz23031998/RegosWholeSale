import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

const objectIs =
  typeof Object.is === "function"
    ? Object.is
    : (x, y) => (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y);

/**
 * ESM stand-in for use-sync-external-store/shim/with-selector.
 * The published entry is CommonJS, and Vite serves it to the browser without
 * converting module.exports, which crashes the client bundle.
 */
export function useSyncExternalStoreWithSelector(
  subscribe,
  getSnapshot,
  getServerSnapshot,
  selector,
  isEqual,
) {
  const instRef = useRef(null);
  const inst =
    instRef.current === null
      ? (instRef.current = { hasValue: false, value: null })
      : instRef.current;

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot;
    let memoizedSelection;

    const memoizedSelector = (nextSnapshot) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue && isEqual(inst.value, nextSelection)) {
          memoizedSelection = inst.value;
          return inst.value;
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const currentSelection = memoizedSelection;
      if (objectIs(memoizedSnapshot, nextSnapshot)) return currentSelection;

      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(currentSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return currentSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const serverSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot;
    return [
      () => memoizedSelector(getSnapshot()),
      serverSnapshot === null ? undefined : () => memoizedSelector(serverSnapshot()),
    ];
  }, [getSnapshot, getServerSnapshot, selector, isEqual, inst]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [inst, value]);

  useDebugValue(value);
  return value;
}

export default { useSyncExternalStoreWithSelector };
