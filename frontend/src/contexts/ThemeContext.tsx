import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  themeService,
  type ThemePreference,
  type ResolvedTheme,
} from "@/services/theme";

interface ThemeProviderProps {
  children: ReactNode;
}

function subscribe(onStoreChange: () => void) {
  return themeService.subscribe(onStoreChange);
}

function getPreferenceSnapshot(): ThemePreference {
  return themeService.getPreference();
}

function getPreferenceServerSnapshot(): ThemePreference {
  return "system";
}

function getResolvedSnapshot(): ResolvedTheme {
  return themeService.getResolvedTheme();
}

function getResolvedServerSnapshot(): ResolvedTheme {
  return "light";
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    themeService.initialize();
  }, []);

  return <>{children}</>;
}

export function useTheme() {
  const preference = useSyncExternalStore(
    subscribe,
    getPreferenceSnapshot,
    getPreferenceServerSnapshot,
  );
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    getResolvedSnapshot,
    getResolvedServerSnapshot,
  );

  const setPreference = useCallback((next: ThemePreference) => {
    themeService.setPreference(next);
  }, []);

  return useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
      options: themeService.getPreferences(),
    }),
    [preference, resolvedTheme, setPreference],
  );
}
