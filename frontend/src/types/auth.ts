export type CompanySummary = {
  id: number;
  name: string;
  slug: string;
  timezone: string;
};

export type AuthUser = {
  id: number;
  company_id: number;
  email: string | null;
  login: string | null;
  display_name: string;
  role: string;
  is_active: boolean;
  permissions: string[];
  company: CompanySummary | null;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

export type ApiValidationError = {
  type: string;
  loc: (string | number)[];
  msg: string;
};

export type ApiErrorBody = {
  detail: string | ApiValidationError[];
  code?: string;
};
