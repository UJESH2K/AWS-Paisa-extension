// Client for the Paisa AWS API (API Gateway + Lambda). No AWS credentials ever
// touch this app: it holds only Paisa's own session token.
import type { Me, ServerSettings, SpendResponse } from "./types";

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const isApiConfigured = BASE.length > 0;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  if (!isApiConfigured) throw new ApiError("API is not configured (NEXT_PUBLIC_API_URL is empty)", 0);
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError("Could not reach the Paisa API. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error ?? body.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

/** First call subscribes the address to AWS SNS (confirmation email); later calls send a sign-in code. */
export const authStart = (email: string) =>
  call<{ status: "confirm_subscription" | "code_sent" }>("/auth/start", { method: "POST", body: json({ email }) });

export const authVerify = (email: string, code: string) =>
  call<{ token: string; email: string }>("/auth/verify", { method: "POST", body: json({ email, code }) });

export const signOutApi = (token: string) => call<{ ok: true }>("/auth/signout", { method: "POST", token });

export const getMe = (token: string) => call<Me>("/me", { token });

export const getSpend = (token: string, refresh = false) =>
  call<SpendResponse>(`/spend${refresh ? "?refresh=1" : ""}`, { token });

export const updateSettings = (token: string, patch: Partial<ServerSettings>) =>
  call<{ ok: true; settings: ServerSettings }>("/settings", { method: "PUT", token, body: json(patch) });

/** Validates a role in the user's own account (test AssumeRole + 1-day Cost Explorer call) and stores it. */
export const connectRole = (token: string, roleArn: string | null) =>
  call<{ ok: true; connected: boolean }>("/connect", { method: "POST", token, body: json({ roleArn }) });

export const emailSummary = (token: string) =>
  call<{ ok: true; sentTo: string }>("/email-summary", { method: "POST", token });
