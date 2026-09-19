"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, connectRole, isApiConfigured, register } from "@/lib/api";
import { loadSession, saveSession, type Session } from "@/lib/session";
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

export default function ConnectFlow() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [arn, setArn] = useState("");
  const [busy, setBusy] = useState<"register" | "connect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Storage is browser-only, so the saved session is read after mount.
    const init = async () => setSession(loadSession());
    void init();
  }, []);

  const onRegister = async () => {
    setBusy("register");
    setError(null);
    try {
      const r = await register();
      const s = { token: r.token, externalId: r.externalId };
      saveSession(s);
      setSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a connect ID.");
    } finally {
      setBusy(null);
    }
  };

  const arnValid = ROLE_ARN.test(arn.trim());

  const onConnect = async () => {
    if (!session) return;
    setBusy("connect");
    setError(null);
    try {
      await connectRole(session.token, arn.trim());
      saveSession({ ...session, roleArn: arn.trim() });
      router.push("/");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not verify the role. Check the ARN and that the stack finished creating.",
      );
    } finally {
      setBusy(null);
    }
  };

  const templateReady = TEMPLATE_URL.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-semibold tracking-tight">Connect your AWS account</h1>
        <p className="mt-1 text-sm text-muted">Three steps, under a minute. Paisa never asks for your access keys.</p>

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
            <Step n={1} title="Create your connect ID" done={!!session}>
              {session ? (
                <p>
                  Done. Your ID is <code className="num rounded bg-raised px-1.5 py-0.5 text-xs text-fg">{session.externalId}</code>. It
                  goes into the role&apos;s trust policy so only Paisa, acting for you, can assume it.
                </p>
              ) : (
                <>
                  <p>Generates a private ID for your role&apos;s trust policy. No password, no email.</p>
                  <Button className="mt-3" onClick={onRegister} disabled={!isApiConfigured || busy !== null}>
                    {busy === "register" ? "Creating…" : "Create connect ID"}
                  </Button>
                </>
              )}
            </Step>

            <Step n={2} title="Create the read-only role" disabled={!session}>
              <p>
                Opens CloudFormation in your account with everything filled in. Review it, tick the
                acknowledgement, and click Create stack.
              </p>
              {session && templateReady ? (
                <a
                  href={quickCreateUrl(session.externalId)}
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
                    : "Complete step 1 first."}
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
                className="num mt-3 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg placeholder:text-faint disabled:cursor-not-allowed"
              />
              {arn && !arnValid && (
                <p className="mt-1.5 text-xs text-markup">That doesn&apos;t look like an IAM role ARN yet.</p>
              )}
              <Button className="mt-3" onClick={onConnect} disabled={!session || !arnValid || busy !== null}>
                {busy === "connect" ? "Verifying…" : "Verify and connect"}
              </Button>
              {error && (
                <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
                  {error}
                </p>
              )}
            </Step>
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
