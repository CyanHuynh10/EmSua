import type { ApiResponse } from "./model";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export async function api<T>(path: string, method = "GET", body: object = {}) {
  const response = await fetch(`/api/${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(15_000),
    ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(() => { throw new ApiError("NETWORK_ERROR", "Không kết nối được. Kiểm tra mạng rồi thử lại."); });
  const result = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!result) throw new ApiError("NETWORK_ERROR", "Máy chủ không phản hồi đúng định dạng.");
  if (!result.success) throw new ApiError(result.error.code, result.error.message);
  return result.data;
}
