import { useState, useEffect, useCallback, Dispatch, SetStateAction } from 'react';

interface FilterStateOptions<T> {
  key: string;
  defaultValue: T;
  deserialize?: (value: string) => T;
  serialize?: (value: T) => string;
}

/**
 * Custom hook that persists state to localStorage and restores it on mount.
 * Perfect for saving filter preferences across sessions.
 */
export function useFilterState<T>(
  options: FilterStateOptions<T>
): [T, Dispatch<SetStateAction<T>>] {
  const {
    key,
    defaultValue,
    deserialize = (v) => JSON.parse(v) as T,
    serialize = (v) => JSON.stringify(v),
  } = options;

  const [state, setState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        return deserialize(saved);
      }
    } catch (err) {
      console.warn(`Failed to load filter state for key "${key}":`, err);
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, serialize(state));
    } catch (err) {
      console.warn(`Failed to save filter state for key "${key}":`, err);
    }
  }, [key, state, serialize]);

  return [state, setState];
}
