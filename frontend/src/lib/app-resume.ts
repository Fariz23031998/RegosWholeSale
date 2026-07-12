/**
 * Fire when the app becomes interactive again after being hidden or restored
 * from the browser back-forward cache (closed tab / history restore).
 */
export function subscribeAppResume(onResume: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onResume();
    }, 250);
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      schedule();
    }
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      schedule();
    }
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pageshow", handlePageShow);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pageshow", handlePageShow);
  };
}
