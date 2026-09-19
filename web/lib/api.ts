// Client for the Paisa AWS API (API Gateway + Lambda). No AWS credentials ever
// touch this app: it holds only our own per-user token.
import type { RegisterResponse, Settings, SpendResponse } from "./types";

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

/** Creates a user and returns the token + the ExternalId for the role's trust policy. */
export const register = () => call<RegisterResponse>("/register", { method: "POST" });

/** Validates the role (test AssumeRole + 1-day Cost Explorer call) and stores it. */
export const connectRole = (token: string, roleArn: string) =>
  call<{ ok: true }>("/connect", { method: "POST", token, body: JSON.stringify({ roleArn }) });

export const getSpend = (token: string) => call<SpendResponse>("/spend", { token });

export const updateSettings = (token: string, s: Settings) =>
  call<{ ok: true }>("/settings", {
    method: "PUT",
    token,
    body: JSON.stringify({ entity: s.entity, markup_pct: s.markupPct, gst_pct: s.gstPct }),
  });
