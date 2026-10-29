/**
 * /widget — the chat surface rendered inside customer pages via an iframe.
 * Reads ?k=<site_key>, talks to /api/chat with SSE, and shows citations.
 */
"use client";

import { Suspense, useSearchParams } from "next/navigation";
import ChatWidget from "@/components/ChatWidget";

function WidgetInner() {
  const params = useSearchParams();
  const siteKey = params.get("k") ?? "";
  if (!siteKey) return <p style={{ padding: 20 }}>Missing site key (k parameter).</p>;
  return <ChatWidget siteKey={siteKey} origin="" />;
}

export default function WidgetPage() {
  return (
    <Suspense fallback={<div className="w-root" />}>
      <WidgetInner />
    </Suspense>
  );
}
