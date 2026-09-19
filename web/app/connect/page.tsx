import type { Metadata } from "next";
import ConnectFlow from "@/components/ConnectFlow";

export const metadata: Metadata = { title: "Connect AWS — Paisa" };

export default function ConnectPage() {
  return <ConnectFlow />;
}
