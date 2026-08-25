import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import {
  createPublicTemplateShare,
  type PublicTemplateShareCreateResponse,
} from "@/lib/receipt-share-api";
import type { ReceiptTemplate } from "@/types/receipt-templates";

export type ShareSessionStatus =
  | "idle"
  | "creating"
  | "ready"
  | "error";

export type ShareSession = {
  status: ShareSessionStatus;
  url: string | null;
  expiresAt: string | null;
  publicToken: string | null;
  error: string | null;
};

type Options = {
  accessToken: string | null;
  template: ReceiptTemplate | null;
  context: DocumentPrintContext | null;
  documentCode: string;
  templateName: string;
  uploadErrorMessage: string;
};

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}

export function useReceiptShareSession({
  accessToken,
  template,
  context,
  documentCode,
  templateName,
  uploadErrorMessage,
}: Options) {
  const [session, setSession] = useState<ShareSession>({
    status: "idle",
    url: null,
    expiresAt: null,
    publicToken: null,
    error: null,
  });
  const inflightRef = useRef<Promise<PublicTemplateShareCreateResponse | null> | null>(null);

  const reset = useCallback(() => {
    inflightRef.current = null;
    setSession({
      status: "idle",
      url: null,
      expiresAt: null,
      publicToken: null,
      error: null,
    });
  }, []);

  useEffect(() => {
    reset();
  }, [context, documentCode, reset, template, templateName]);

  const ensureShareUrl = useCallback(async (): Promise<PublicTemplateShareCreateResponse> => {
    if (!accessToken) {
      throw new Error(uploadErrorMessage);
    }
    if (!template || !context) {
      throw new Error(uploadErrorMessage);
    }
    if (session.url && session.expiresAt && !isExpired(session.expiresAt)) {
      return {
        public_token: session.publicToken ?? "",
        url: session.url,
        public_expires_at: session.expiresAt,
        is_public: true,
      };
    }

    if (inflightRef.current) {
      const pending = await inflightRef.current;
      if (pending) return pending;
    }

    const task = (async () => {
      setSession((current) => ({
        ...current,
        status: "creating",
        error: null,
      }));
      try {
        const response = await createPublicTemplateShare(accessToken, {
          template,
          context,
          documentCode,
        });
        setSession({
          status: "ready",
          url: response.url,
          expiresAt: response.public_expires_at,
          publicToken: response.public_token,
          error: null,
        });
        return response;
      } catch (err: unknown) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : uploadErrorMessage;
        setSession((current) => ({
          ...current,
          status: "error",
          error: message || uploadErrorMessage,
        }));
        return null;
      } finally {
        inflightRef.current = null;
      }
    })();

    inflightRef.current = task;
    const result = await task;
    if (!result) {
      throw new Error(uploadErrorMessage);
    }
    return result;
  }, [
    accessToken,
    context,
    documentCode,
    session.expiresAt,
    session.publicToken,
    session.url,
    template,
    uploadErrorMessage,
  ]);

  const linkExpired = isExpired(session.expiresAt);

  return {
    session,
    linkExpired,
    reset,
    ensureShareUrl,
  };
}
