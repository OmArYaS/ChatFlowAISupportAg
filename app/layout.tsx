import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatFlow — AI Support Agents for any website",
  description:
    "Embeddable AI support widget: crawls your site, stores embeddings, answers customers with RAG. Built on Supabase with streaming responses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
