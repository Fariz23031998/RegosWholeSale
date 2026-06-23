import { useEffect, useMemo, useState } from "react";
import { fetchReceiptTemplates } from "@/lib/receipt-templates-api";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import { resolveDefaultTemplate } from "@/components/Receipt/TemplatedReceiptView";

export function useReceiptTemplates(token: string | null) {
  const [templates, setTemplates] = useState<ReceiptTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setTemplates([]);
      setDefaultTemplateId(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchReceiptTemplates(token)
      .then((response) => {
        if (cancelled) return;
        setTemplates(response.settings.templates);
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

    return () => {
      cancelled = true;
    };
  }, [token]);

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
