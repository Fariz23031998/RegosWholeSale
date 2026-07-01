import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  buildReceiptFilename,
  generateReceiptPdfBlob,
} from "@/lib/receipt-pdf";
import { uploadReceiptShare, type ReceiptShareCreateResponse } from "@/lib/receipt-share-api";
import type { ReceiptFormat } from "@/types/receipt-templates";

export type ShareSessionStatus =
  | "idle"
  | "generating"
  | "uploading"
  | "ready"
  | "error";

export type ShareSession = {
  status: ShareSessionStatus;
  url: string | null;
  expiresAt: string | null;
  filename: string | null;
  error: string | null;
};

type Options = {
  accessToken: string | null;
  printRoot: HTMLElement | null;
  format: ReceiptFormat | null;
  documentCode: string;
  templateName: string;
  generateErrorMessage: string;
  uploadErrorMessage: string;
};

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}

export function useReceiptShareSession({
  accessToken,
  printRoot,
  format,
  documentCode,
  templateName,
  generateErrorMessage,
  uploadErrorMessage,
}: Options) {
  const [session, setSession] = useState<ShareSession>({
    status: "idle",
    url: null,
    expiresAt: null,
    filename: null,
    error: null,
  });
  const pdfBlobRef = useRef<Blob | null>(null);
  const inflightRef = useRef<Promise<ReceiptShareCreateResponse | null> | null>(null);

  const reset = useCallback(() => {
    pdfBlobRef.current = null;
    inflightRef.current = null;
    setSession({
      status: "idle",
      url: null,
      expiresAt: null,
      filename: null,
      error: null,
    });
  }, []);

  useEffect(() => {
    reset();
  }, [documentCode, format, printRoot, reset, templateName]);

  const ensurePdfBlob = useCallback(async (): Promise<Blob> => {
    if (pdfBlobRef.current) return pdfBlobRef.current;
    if (!printRoot || !format) {
      throw new Error(generateErrorMessage);
    }
    setSession((current) => ({
      ...current,
      status: "generating",
      error: null,
    }));
    try {
      const blob = await generateReceiptPdfBlob(printRoot, format);
      pdfBlobRef.current = blob;
      setSession((current) => ({
        ...current,
        status: current.status === "uploading" ? "uploading" : "idle",
        error: null,
      }));
      return blob;
    } catch {
      setSession((current) => ({
        ...current,
        status: "error",
        error: generateErrorMessage,
      }));
      throw new Error(generateErrorMessage);
    }
  }, [format, generateErrorMessage, printRoot]);

  const ensureShareUrl = useCallback(async (): Promise<ReceiptShareCreateResponse> => {
    if (!accessToken) {
      throw new Error(uploadErrorMessage);
    }
    if (session.url && session.expiresAt && !isExpired(session.expiresAt)) {
      return {
        share_id: "",
        url: session.url,
        expires_at: session.expiresAt,
        filename: session.filename ?? buildReceiptFilename(documentCode),
      };
    }

    if (inflightRef.current) {
      const pending = await inflightRef.current;
      if (pending) return pending;
    }

    const task = (async () => {
      setSession((current) => ({
        ...current,
        status: "uploading",
        error: null,
      }));
      try {
        const blob = await ensurePdfBlob();
        const filename = buildReceiptFilename(documentCode);
        const response = await uploadReceiptShare(accessToken, blob, {
          filename,
          documentCode,
          templateName,
        });
        setSession({
          status: "ready",
          url: response.url,
          expiresAt: response.expires_at,
          filename: response.filename,
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
    documentCode,
    ensurePdfBlob,
    session.expiresAt,
    session.filename,
    session.url,
    templateName,
    uploadErrorMessage,
  ]);

  const getPdfBlob = useCallback(async () => ensurePdfBlob(), [ensurePdfBlob]);

  const linkExpired = isExpired(session.expiresAt);

  return {
    session,
    linkExpired,
    reset,
    ensureShareUrl,
    getPdfBlob,
    filename: session.filename ?? buildReceiptFilename(documentCode),
  };
}
