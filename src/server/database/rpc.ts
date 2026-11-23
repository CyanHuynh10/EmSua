import "server-only";

export async function rpc<T>(name: string, args: object = {}): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error("Supabase configuration is missing");
  const url = new URL(base);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Supabase requires HTTPS");
  }
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
    method: "POST", headers, body: JSON.stringify(args), cache: "no-store",
    signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  if (!response.ok) {
    const issue = await response.json().catch(() => null) as { code?: unknown } | null;
    const code = typeof issue?.code === "string" && /^[\w]{1,15}$/.test(issue.code) ? issue.code : "-";
    throw new Error(`Supabase ${name} returned ${response.status} (${code})`);
  }
  return response.json() as Promise<T>;
}
