export interface Site {
  id: string;
  site_key: string;
  owner_id: string;
  name: string;
  url: string;
  agent_name: string;
  greeting: string;
  system_prompt: string;
  limits: {
    pages_max: number;
    messages_per_hour_per_visitor: number;
    temperature: number;
  };
  crawl_status: "idle" | "running" | "done" | "failed";
  created_at: string;
}

export interface Source {
  url: string;
  title: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Source[];
}

export interface Chunk {
  content: string;
  url: string;
  title: string;
  similarity: number;
}
