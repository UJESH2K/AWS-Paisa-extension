"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, authStart, authVerify, connectRole, getMe, isApiConfigured } from "@/lib/api";
import { loadSession, saveSession, type Session } from "@/lib/session";
import type { Me } from "@/lib/types";
import { Button, Card, Chip } from "./ui";

const REGION = process.env.NEXT_PUBLIC_AWS_REGION || "ap-south-1";
const TEMPLATE_URL = process.env.NEXT_PUBLIC_ROLE_TEMPLATE_URL ?? "";
const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

function quickCreateUrl(externalId: string) {
  const q = new URLSearchParams({
    templateURL: TEMPLATE_URL,
    stackName: "PaisaReadOnly",
    param_ExternalId: externalId,
  });
  return `https://${REGION}.console.aws.amazon.com/cloudformation/home?region=${REGION}#/stacks/quickcreate?${q}`;
}

function Step({
  n,
  title,
  done,
  disabled,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={`flex gap-4 ${disabled ? "opacity-45" : ""}`}>
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
          done ? "border-accent bg-accent text-bg" : "border-line text-muted"
        }`}
        aria-hidden
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 pb-8">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

const inputCls =
  "num h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg placeholder:text-faint disabled:cursor-not-allowed";

export default function ConnectFlow() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [stage, setStage] = useState<"email" | "confirm" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [arn, setArn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Storage is browser-only, so the saved session is read after mount.
    const init = async () => {
      const s = loadSession();
      setSession(s);
      if (s && isApiConfigured) setMe(await getMe(s.token).catch(() => null));
    };
    void init();
  }, []);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onStart = () =>
    guard(async () => {
      const r = await authStart(email.trim());
      setStage(r.status === "code_sent" ? "code" : "confirm");
    });

  const onVerify = () =>
    guard(async () => {
      const r = await authVerify(email.trim(), code.trim());
      const s = { token: r.token, email: r.email };
      saveSession(s);
      setSession(s);
      setMe(await getMe(s.token).catch(() => null));
    });

  const arnValid = ROLE_ARN.test(arn.trim());
  const onConnect = () =>
    guard(async () => {
      if (!session) return;
      await connectRole(session.token, arn.trim());
      router.push("/");
    });

  const templateReady = TEMPLATE_URL.length > 0;
  const signedIn = !!session;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in and connect AWS</h1>
        <p className="mt-1 text-sm text-muted">
          Sign in with your email. No password, and Paisa never asks for your AWS access keys.
        </p>

        {!isApiConfigured && (
          <p className="mt-4 rounded-xl border border-markup/30 bg-markup/10 px-4 py-3 text-sm" role="status">
            <strong className="font-medium text-markup">Not available in this build.</strong>{" "}
            <span className="text-muted">
              The Paisa API URL isn&apos;t configured (NEXT_PUBLIC_API_URL), so nothing below can run yet.
            </span>
          </p>
        )}

        <Card className="mt-6">
          <ol>
            <Step n={1} title="Sign in with your email" done={signedIn}>
              {signedIn ? (
                <p>
                  Signed in as <span className="text-fg">{session?.email}</span>.
                </p>
              ) : stage === "email" ? (
                <>
                  <p>We&apos;ll send a 6-digit code. The first time, AWS also asks you to confirm your email once.</p>
                  <label htmlFor="email" className="sr-only">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!isApiConfigured}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className={`${inputCls} mt-3`}
                  />
                  <Button className="mt-3" onClick={onStart} disabled={!isApiConfigured || busy || !email.includes("@")}>
                    {busy ? "Sending…" : "Send me a code"}
                  </Button>
                </>
              ) : stage === "confirm" ? (
                <>
                  <p>
                    AWS emailed <span className="text-fg">{email}</span> a &quot;Confirm subscription&quot; link. Click it
                    (check spam), then continue.
                  </p>
                  <Button className="mt-3" onClick={onStart} disabled={busy}>
                    {busy ? "Checking…" : "I've confirmed, send my code"}
                  </Button>
                </>
              ) : (
                <>
                  <p>
                    Enter the 6-digit code we emailed to <span className="text-fg">{email}</span>.
                  </p>
                  <label htmlFor="code" className="sr-only">
                    Sign-in code
                  </label>
                  <input
                    id="code"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    className={`${inputCls} mt-3 max-w-40 text-center tracking-[0.4em]`}
                  />
                  <Button className="mt-3" onClick={onVerify} disabled={busy || code.length !== 6}>
                    {busy ? "Checking…" : "Sign in"}
                  </Button>
                </>
              )}
              {error && (
                <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
                  {error}
                </p>
              )}
            </Step>

            {me?.isOwner ? (
              <Step n={2} title="Your AWS account is already connected" done>
                <p>
                  You&apos;re the owner of this Paisa deployment, so it reads its own account&apos;s costs. Nothing more to set up.
                </p>
                <Button className="mt-3" onClick={() => router.push("/")}>
                  Open the dashboard
                </Button>
              </Step>
            ) : (
              <>
                <Step n={2} title="Create the read-only role in your AWS account" disabled={!session}>
                  <p>
                    Opens CloudFormation in your account with everything filled in. Review it, tick the acknowledgement,
                    and click Create stack.
                  </p>
                  {session && me && templateReady ? (
                    <a
                      href={quickCreateUrl(me.externalId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-bg hover:bg-[#8ab8ff]"
                    >
                      Create the read-only role ↗
                    </a>
                  ) : (
                    <p className="mt-3 text-xs text-faint">
                      {session
                        ? "The role template URL isn't configured for this build (NEXT_PUBLIC_ROLE_TEMPLATE_URL)."
                        : "Sign in first."}
                    </p>
                  )}
                </Step>

                <Step n={3} title="Paste the role ARN" disabled={!session}>
                  <p>
                    When the stack finishes, copy <span className="text-fg">RoleArn</span> from its Outputs tab.
                  </p>
                  <label htmlFor="arn" className="sr-only">
                    Role ARN
                  </label>
                  <input
                    id="arn"
                    value={arn}
                    onChange={(e) => setArn(e.target.value)}
                    disabled={!session}
                    placeholder="arn:aws:iam::123456789012:role/PaisaReadOnlyRole"
                    spellCheck={false}
                    autoComplete="off"
                    className={`${inputCls} mt-3`}
                  />
                  {arn && !arnValid && (
                    <p className="mt-1.5 text-xs text-markup">That doesn&apos;t look like an IAM role ARN yet.</p>
                  )}
                  <Button className="mt-3" onClick={onConnect} disabled={!session || !arnValid || busy}>
                    {busy ? "Verifying…" : "Verify and connect"}
                  </Button>
                </Step>
              </>
            )}
          </ol>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card title="What Paisa can read">
          <ul className="space-y-2 font-mono text-xs text-fg">
            <li>ce:GetCostAndUsage</li>
            <li>ce:GetCostForecast</li>
            <li>ce:GetDimensionValues</li>
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            That&apos;s it. Billing figures only: no resources, no data, no write access. Delete the CloudFormation stack
            to revoke it instantly.
          </p>
        </Card>
        <Card title="What Paisa never sees">
          <p className="text-xs leading-relaxed text-muted">
            Your access keys or passwords. The role can only be assumed with your private connect ID, which stops another
            AWS customer from tricking Paisa into reading your account.
          </p>
          <div className="mt-3">
            <Chip tone="accent">No credentials in the browser</Chip>
          </div>
        </Card>
      </aside>
    </div>
  );
}
