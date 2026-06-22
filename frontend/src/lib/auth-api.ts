import { apiRequest } from "@/lib/api";
import type { AuthResponse, AuthUser } from "@/types/auth";

export async function sendVerificationCode(
  email: string,
  type: "register" | "reset_password",
): Promise<{ ok: boolean; message: string }> {
  return apiRequest("/api/v1/auth/send-verification-code", {
    method: "POST",
    body: { email, type },
  });
}

export async function registerOwner(payload: {
  email: string;
  password: string;
  display_name: string;
  company_name: string;
  verification_code: string;
}): Promise<AuthResponse> {
  return apiRequest("/api/v1/auth/register", { method: "POST", body: payload });
}

export async function login(identifier: string, password: string): Promise<AuthResponse> {
  const body = identifier.includes("@")
    ? { email: identifier, password }
    : { login: identifier, password };
  return apiRequest("/api/v1/auth/login", {
    method: "POST",
    body,
  });
}

export async function resetPassword(payload: {
  email: string;
  verification_code: string;
  new_password: string;
}): Promise<{ message: string }> {
  return apiRequest("/api/v1/auth/reset-password", { method: "POST", body: payload });
}

export async function fetchMe(token: string): Promise<AuthUser> {
  return apiRequest("/api/v1/auth/me", { token });
}
