import type { ApiSuccess, ApiError } from "@/types";

export function success<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return { success: true, data, meta };
}

export function error(code: string, message: string, details?: unknown): ApiError {
  return {
    success: false,
    error: { code, message, details },
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}
