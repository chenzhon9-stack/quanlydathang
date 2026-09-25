/**
 * AuditLog tối thiểu — D99
 * Cột: Thời gian / Email / Role / Action / Source / MaDon / ID_Chitiet / ID_Giaohang / TargetId / OldValue / NewValue / LyDo
 * (header thực tế có thể khác — map linh hoạt qua STANDARD_HEADERS nếu có)
 */
import { SHEETS } from "@/lib/sheets/constants";
import { appendSheetRow } from "@/lib/sheets/dal";
import { isSheetsConfigured } from "@/lib/sheets/client";

export async function writeAudit(entry: {
  email?: string;
  role?: string;
  action: string;
  source?: string;
  maDon?: string;
  idCt?: string;
  idGh?: string;
  targetId?: string;
  oldValue?: string;
  newValue?: string;
  lyDo?: string;
  year?: number;
}): Promise<void> {
  if (!isSheetsConfigured()) return;
  try {
    await appendSheetRow(
      SHEETS.AUDIT,
      {
        // thử nhiều tên cột phổ biến V21
        "Thời gian": new Date().toISOString(),
        ThoiGian: new Date().toISOString(),
        Timestamp: new Date().toISOString(),
        Email: entry.email || "",
        Role: entry.role || "",
        Action: entry.action,
        Source: entry.source || "vercel",
        MaDon: entry.maDon || "",
        ID_Chitiet: entry.idCt || "",
        ID_Giaohang: entry.idGh || "",
        TargetId: entry.targetId || entry.maDon || entry.idCt || "",
        OldValue: entry.oldValue || "",
        NewValue: entry.newValue || "",
        LyDo: entry.lyDo || "",
      },
      entry.year
    );
  } catch (e) {
    console.warn("[AuditLog] skip", e);
  }
}
