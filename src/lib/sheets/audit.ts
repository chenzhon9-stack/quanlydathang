/**
 * AuditLog — parity V21 _writeAudit_
 * STANDARD_HEADERS.AuditLog:
 *   Timestamp | Email | Role | Action | Source | MaDon | ID_Chitiet |
 *   ID_Giaohang | TargetId | OldValue | NewValue | LyDo
 *
 * Mọi write path nghiệp vụ phải gọi writeAudit (best-effort, không throw).
 */
import { SHEETS } from "@/lib/sheets/constants";
import { appendSheetRow } from "@/lib/sheets/dal";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { formatDateTimeVN } from "@/lib/sheets/date";

/** Action codes chuẩn (thống nhất log) */
export const AUDIT_ACTION = {
  CREATE_ORDER: "CREATE_ORDER",
  ADD_DETAIL: "ADD_DETAIL",
  CANCEL_ORDER: "CANCEL_ORDER",
  CANCEL_DETAIL: "CANCEL_DETAIL",
  DELETE_DETAIL: "DELETE_DETAIL",
  RECEIVE_DETAIL: "RECEIVE_DETAIL",
  SAVE_PLAN: "SAVE_PLAN",
  SAVE_DELIVERY: "SAVE_DELIVERY",
  SEND_ORDER: "SEND_ORDER",
  SEND_ORDER_SHEET_ONLY: "SEND_ORDER_SHEET_ONLY",
  SEND_ORDER_GAS: "SEND_ORDER_GAS",
  RESET_ORDER_FULL: "RESET_ORDER_FULL",
  RESET_ORDER_PARTIAL: "RESET_ORDER_PARTIAL",
  PLAN_CREATE: "PLAN_CREATE",
  PLAN_UPDATE: "PLAN_UPDATE",
  PLAN_CANCEL: "PLAN_CANCEL",
  QUICK_ADD_DVT: "QUICK_ADD_DVT",
  QUICK_ADD_XE: "QUICK_ADD_XE",
  USER_UPDATE: "USER_UPDATE",
  USER_ROLE_APPEND: "USER_ROLE_APPEND",
  PAYABLE_CREATE: "PAYABLE_CREATE",
  PAYABLE_VOID: "PAYABLE_VOID",
} as const;

export type AuditAction =
  | (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION]
  | string;

export type AuditEntry = {
  email?: string;
  role?: string;
  action: AuditAction;
  source?: string;
  maDon?: string;
  idCt?: string;
  idGh?: string;
  targetId?: string;
  oldValue?: string | object;
  newValue?: string | object;
  lyDo?: string;
  year?: number;
};

function asStr(v: string | object | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Ghi 1 dòng AuditLog. Không throw — lỗi chỉ log console.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  if (!isSheetsConfigured()) return;
  if (!entry?.action) return;
  try {
    const ts = formatDateTimeVN(new Date());
    await appendSheetRow(
      SHEETS.AUDIT,
      {
        // Đúng STANDARD_HEADERS
        Timestamp: ts,
        Email: entry.email || "",
        Role: entry.role || "",
        Action: entry.action,
        Source: entry.source || "vercel",
        MaDon: entry.maDon || "",
        ID_Chitiet: entry.idCt || "",
        ID_Giaohang: entry.idGh || "",
        TargetId:
          entry.targetId ||
          entry.maDon ||
          entry.idCt ||
          entry.idGh ||
          "",
        OldValue: asStr(entry.oldValue),
        NewValue: asStr(entry.newValue),
        LyDo: entry.lyDo || "",
        // Alias header cũ (nếu sheet còn cột)
        "Thời gian": ts,
        ThoiGian: ts,
      },
      entry.year
    );
  } catch (e) {
    console.warn("[AuditLog] skip", entry.action, e);
  }
}
