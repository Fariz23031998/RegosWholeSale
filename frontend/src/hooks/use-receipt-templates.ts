import { useEffect, useMemo, useRef, useState } from "react";
import { fetchReceiptTemplates } from "@/lib/receipt-templates-api";
import { subscribeSettingsEvents } from "@/lib/settings-events";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import { resolveDefaultTemplate } from "@/components/Receipt/TemplatedReceiptView";
import { normalizeReceiptTemplates } from "@/lib/receipt-template-utils";

export function useReceiptTemplates(
  token: string | null,
  companyId?: number | null,
) {
  const [templates, setTemplates] = useState<ReceiptTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cacheScope = useMemo(
    () => (companyId != null ? { companyId } : undefined),
    [companyId],
  );
  const reloadTemplatesRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!token) {
      setTemplates([]);
      setDefaultTemplateId(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const reload = () => {
      void fetchReceiptTemplates(token, { force: true, cacheScope })
        .then((response) => {
          if (cancelled) return;
          setTemplates(normalizeReceiptTemplates(response.settings.templates));
          setDefaultTemplateId(response.settings.default_template_id);
        })
        .catch(() => {
          if (cancelled) return;
          setTemplates([]);
          setDefaultTemplateId(null);
          setError("Failed to load receipt templates");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    reloadTemplatesRef.current = reload;
    reload();

    return () => {
      cancelled = true;
    };
  }, [cacheScope, token]);

  useEffect(() => {
    return subscribeSettingsEvents((event) => {
      if (event.scope !== "company" || event.namespace !== "receipt_templates") return;
      reloadTemplatesRef.current();
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
