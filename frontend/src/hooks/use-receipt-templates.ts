import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchReceiptTemplates,
  getCachedReceiptTemplates,
  invalidateReceiptTemplatesCache,
} from "@/lib/receipt-templates-api";
import { subscribeSettingsEvents } from "@/lib/settings-events";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import { resolveDefaultTemplate } from "@/components/Receipt/TemplatedReceiptView";
import { normalizeReceiptTemplates } from "@/lib/receipt-template-utils";

function applyTemplatesResponse(
  response: {
    settings: { templates: ReceiptTemplate[]; default_template_id: string | null };
  },
  setTemplates: (templates: ReceiptTemplate[]) => void,
  setDefaultTemplateId: (id: string | null) => void,
) {
  setTemplates(normalizeReceiptTemplates(response.settings.templates));
  setDefaultTemplateId(response.settings.default_template_id);
}

export function useReceiptTemplates(
  token: string | null,
  companyId?: number | null,
) {
  const cacheScope = useMemo(
    () => (companyId != null ? { companyId } : undefined),
    [companyId],
  );

  const initialCached = token ? getCachedReceiptTemplates(token) : null;
  const [templates, setTemplates] = useState<ReceiptTemplate[]>(() =>
    initialCached
      ? normalizeReceiptTemplates(initialCached.settings.templates)
      : [],
  );
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(
    () => initialCached?.settings.default_template_id ?? null,
  );
  const [loading, setLoading] = useState(() => Boolean(token) && !initialCached);
  const [error, setError] = useState("");
  const reloadTemplatesRef = useRef<(force?: boolean) => void>(() => undefined);

  useEffect(() => {
    if (!token) {
      setTemplates([]);
      setDefaultTemplateId(null);
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    const cached = getCachedReceiptTemplates(token);
    if (cached) {
      applyTemplatesResponse(cached, setTemplates, setDefaultTemplateId);
      setLoading(false);
      setError("");
    } else {
      setLoading(true);
      setError("");
    }

    const reload = (force = false) => {
      if (force) {
        invalidateReceiptTemplatesCache(token);
      }
      void fetchReceiptTemplates(token, { force, cacheScope })
        .then((response) => {
          if (cancelled) return;
          applyTemplatesResponse(response, setTemplates, setDefaultTemplateId);
          setError("");
        })
        .catch(() => {
          if (cancelled) return;
          if (!getCachedReceiptTemplates(token)) {
            setTemplates([]);
            setDefaultTemplateId(null);
          }
          setError("Failed to load receipt templates");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    reloadTemplatesRef.current = reload;
    reload(false);

    return () => {
      cancelled = true;
    };
  }, [cacheScope, token]);

  useEffect(() => {
    return subscribeSettingsEvents((event) => {
      if (event.scope !== "company" || event.namespace !== "receipt_templates") return;
      reloadTemplatesRef.current(true);
    });
  }, []);

  const defaultTemplate = useMemo(
    () => resolveDefaultTemplate(templates, defaultTemplateId),
    [defaultTemplateId, templates],
  );

  return {
    templates,
    defaultTemplate,
    defaultTemplateId,
    loading,
    error,
  };
}
