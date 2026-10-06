export interface EmbeddingOutcome { status: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE"; vector: number[] | null; model: string | null }

/** Calls only FastAPI's token-protected embedding utility; never logs request text or provider errors. */
export async function createEmbedding(text: string): Promise<EmbeddingOutcome> {
  const baseUrl = process.env.AI_SERVICE_URL;
  const token = process.env.AI_SERVICE_TOKEN;
  if (!baseUrl || !token) return { status: "NOT_CONFIGURED", vector: null, model: null };
  let response: Response;
  try {
    response = await fetch(new URL("internal/ai/embed", `${new URL(baseUrl).toString().replace(/\/+$/, "")}/`), {
      method: "POST", headers: { "content-type": "application/json", "X-Service-Token": token },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 503) return { status: "NOT_CONFIGURED", vector: null, model: null };
    if (!response.ok) return { status: "UNAVAILABLE", vector: null, model: null };
    const body = await response.json() as { status?: string; vector?: unknown; model?: unknown };
    if (body.status !== "READY" || !Array.isArray(body.vector) || body.vector.length !== 768 || body.vector.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      return { status: body.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE", vector: null, model: null };
    }
    return { status: "READY", vector: body.vector as number[], model: typeof body.model === "string" ? body.model : null };
  } catch { return { status: "UNAVAILABLE", vector: null, model: null }; }
}
