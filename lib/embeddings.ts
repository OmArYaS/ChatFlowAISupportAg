const EMBED_URL = process.env.EMBED_API_BASE
  ? `${process.env.EMBED_API_BASE}/embeddings`
  : "https://api.openai.com/v1/embeddings";
