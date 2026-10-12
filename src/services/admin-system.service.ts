/**
 * Admin — Bảo trì hệ thống (parity V21.07 KHỐI 6)
 * requireAdminVerified only.
 *
 * Đã chỉnh theo review:
 * - capNhatThucTeKeHoach: SUM ThucNhan CT theo NCC|HH|kỳ (cắt hết hôm qua)
 * - repairAllOrderStatuses: 3 bước (SoLuong từ GH → TrangThaiXe hao hụt → TrangThaiDon)
 * - validateStandardSchema: đọc header dòng 1 thật
 * - setupStandardSchema: bổ sung header thiếu
 * - isOrderSent parity GAS; isStandardGhId; purge 60d min 7, bỏ __LOCK__*
 */
import { listUsersFromSheet } from "@/lib/auth";
import { isSheetsConfigured, getSheetsClient, getSpreadsheetId } from "@/lib/sheets/client";
import {
  readSheetAsObjects,
  updateSheetRowByKey,
  invalidateSheetCache,
} from "@/lib/sheets/dal";
import { SHEETS, STANDARD_HEADERS } from "@/lib/sheets/constants";
import { sheetCacheStats } from "@/lib/sheets/sheet-cache";
import { STATUS_CT, STATUS_DON } from "@/lib/status";
import {
  todayYmdVN,
  ymdDate,
  formatDateTimeVN,
  currentYearVN,
  addDaysYmd,
} from "@/lib/sheets/date";
import { computePlanStatus } from "@/lib/plan-status";
import { syncOrderStatusByOrderId } from "@/lib/sync-order-status";
import { writeAudit } from "@/lib/sheets/audit";
import { validateTolerance, qty3 } from "@/lib/business-rules";
import { isStandardGhId } from "@/lib/sheets/counter";
import type { UserContext } from "@/types";

// ─── helpers ────────────────────────────────────────────────

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  const map = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = map.get(k.toLowerCase());
    if (real && String(row[real] ?? "").trim()) return String(row[real]).trim();
  }
  return "";
}

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function boolText(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return true; // trống = hoạt động (parity _boolText_ thường)
  if (["0", "false", "no", "n", "không", "khong"].includes(s)) return false;
  return true;
}

function isDeleteCt(st: string): boolean {
  const s = String(st || "").trim();
  return s === STATUS_CT.DELETE || s === "DELETE" || s.includes("Xóa");
}

function isCancelCt(st: string): boolean {
  const s = String(st || "").trim();
  return s === STATUS_CT.CANCEL || s === "CANCEL" || s === "Hủy xe" || s === "Hủy";
}

function isNewCt(st: string): boolean {
  const s = String(st || "").trim();
  return !s || s === STATUS_CT.NEW || s === "NEW" || s === "Mới tạo" || s === "Khởi tạo";
}

function isGhDeleted(row: Record<string, string>): boolean {
  const d = pick(row, ["Deleted", "deleted"]);
  return d === "1" || d.toLowerCase() === "true" || d === "TRUE";
}

/** V21 _isOrderSent_ */
function isOrderSent(dh: Record<string, string>): boolean {
  const st = pick(dh, ["TrangThaiDon", "TrangThai"]);
  if (st === STATUS_DON.PROCESSING || st === "PROCESSING" || st === "Đang xử lý") return true;
  if (st === STATUS_DON.DONE || st === "DONE" || st === "Hoàn thành") return true;
  if (num(pick(dh, ["LanGui"])) > 0) return true;
  const cho = pick(dh, ["ChoGuiMail", "choGuiMail"]);
  if (cho === "1" || cho.toLowerCase() === "true") return true;
  if (pick(dh, ["timeGuimail", "TimeGuiMail", "timeGuiMail"])) return true;
  return false;
}

/** Throttle 30s / action / instance (parity Utilities.sleep gate GAS) */
const _lastRun = new Map<string, number>();
function throttleOrThrow(action: string, ms = 30_000): void {
  const now = Date.now();
  const prev = _lastRun.get(action) || 0;
  if (now - prev < ms) {
    const wait = Math.ceil((ms - (now - prev)) / 1000);
    throw new Error(`Chờ ${wait}s trước khi chạy lại «${action}» (throttle 30s).`);
  }
  _lastRun.set(action, now);
}

/** Đọc header dòng 1 thật (không suy từ data row) */
export async function readSheetHeaders(
  sheetName: string,
  year?: number
): Promise<string[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const row = (res.data.values && res.data.values[0]) || [];
  return row.map((h) => String(h ?? "").trim());
}

/** Ghi nhiều ô theo A1 range — giảm quota */
async function batchUpdateValues(
  year: number | undefined,
  data: Array<{ range: string; values: (string | number | boolean)[][] }>
): Promise<void> {
  if (!data.length) return;
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  // chunk 100
  for (let i = 0; i < data.length; i += 100) {
    const chunk = data.slice(i, i + 100);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: chunk.map((d) => ({
          range: d.range,
          majorDimension: "ROWS",
          values: d.values,
        })),
      },
    });
  }
}

/** Map header → column index 0-based; build A1 col letter */
function colLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Dòng sheet + số dòng A1 (header = 1). __row nội bộ — cast khi gán. */
type RowWithIndex = Record<string, string> & { __row: number };

async function loadSheetWithRowIndex(
  sheetName: string,
  year?: number
): Promise<{
  headers: string[];
  rows: RowWithIndex[];
}> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const values = res.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] as unknown[]).map((h) => String(h ?? "").trim());
  const rows: RowWithIndex[] = values.slice(1).map((row, i) => {
    const cells: Record<string, string> = {};
    headers.forEach((h, ci) => {
      if (!h) return;
      const cell = row[ci];
      if (cell === null || cell === undefined) cells[h] = "";
      else if (typeof cell === "number") cells[h] = String(cell);
      else cells[h] = String(cell).trim();
    });
    // Ép kiểu: __row chỉ dùng nội bộ, không nằm trong index signature data
    return { ...cells, __row: i + 2 } as RowWithIndex;
  });
  return { headers, rows };
}

// ─── stats ──────────────────────────────────────────────────

export async function getAdminStats(year?: number) {
  const y = year ?? currentYearVN();
  const today = todayYmdVN();

  let usersTotal = 0;
  let usersActive = 0;
  let usersPending = 0;
  try {
    const users = (await listUsersFromSheet()) as Array<Record<string, unknown>>;
    usersTotal = users.length;
    for (const u of users) {
      const st = String(u.trangThai || u.TrangThai || u.status || "").trim();
      const stL = st.toLowerCase();
      const active = boolText(u.hoatDong ?? u.HoatDong);
      if (active) usersActive += 1;
      if (st === "Pending" || stL === "pending" || stL.includes("chờ") || stL.includes("cho duyet")) {
        usersPending += 1;
      }
    }
  } catch (e) {
    console.warn("[admin-stats] users", e);
  }

  let ordersTotal = 0;
  let ordersToday = 0;
  let ordersProcessing = 0;
  try {
    const dh = await readSheetAsObjects(SHEETS.DH, { year: y });
    ordersTotal = dh.length;
    for (const r of dh) {
      const od = ymdDate(pick(r, ["NgayDatHang"])) || "";
      if (od === today) ordersToday += 1;
      const st = pick(r, ["TrangThaiDon", "TrangThai"]);
      if (st === STATUS_DON.PROCESSING || st === "PROCESSING" || st === "Đang xử lý") {
        ordersProcessing += 1;
      }
    }
  } catch (e) {
    console.warn("[admin-stats] orders", e);
  }

  const cache = sheetCacheStats();
  // Cảnh báo theo số entry instance (không phải KB sheet GAS)
  const cacheWarning = Number(cache.size || 0) > 40 ? 1 : 0;

  return {
    year: y,
    today,
    usersTotal,
    usersActive,
    usersPending,
    ordersTotal,
    ordersToday,
    ordersProcessing,
    cacheEntries: cache.size ?? 0,
    cacheWarning,
    cacheNote: "Cache instance Vercel (không đo KB sheet như GAS)",
    sheetsConfigured: isSheetsConfigured(),
  };
}

// ─── capNhatThucTeKeHoach ───────────────────────────────────

/**
 * V21: ThucTe = SUM(CT.ThucNhan) theo MaNCC + MaHH ∈ DanhSachHH,
 * NgayNhanHang ∈ [TuNgay, min(DenNgay, hết hôm qua)].
 * Ghi ThucTe + TrangThai + NgayCapNhat.
 */
export async function capNhatThucTeKeHoach(user: UserContext, year?: number) {
  throttleOrThrow("capNhatThucTeKeHoach");
  const y = year ?? currentYearVN();
  const yesterday = addDaysYmd(todayYmdVN(), -1);

  const [plansPack, ctRows] = await Promise.all([
    loadSheetWithRowIndex(SHEETS.KHSL, y),
    readSheetAsObjects(SHEETS.CT, { year: y, noCache: true }),
  ]);

  // Pre-index CT: key ncc|hh → list {ymd, qty}
  type CtHit = { ymd: string; qty: number; ncc: string; hh: string };
  const ctHits: CtHit[] = [];
  for (const r of ctRows) {
    const st = pick(r, ["TrangThaiXe", "TrangThai"]);
    if (isDeleteCt(st) || isCancelCt(st)) continue;
    const tn = num(pick(r, ["ThucNhan"]));
    if (tn <= 0) continue;
    const ncc = pick(r, ["MaNCC"]).toUpperCase();
    const hh = pick(r, ["MaHH"]).toUpperCase();
    const ymd =
      ymdDate(pick(r, ["NgayNhanHang", "NgayNhan"])) ||
      ymdDate(pick(r, ["NgayDatHang"])) ||
      "";
    if (!ncc || !hh || !ymd) continue;
    ctHits.push({ ymd, qty: tn, ncc, hh });
  }

  const h = plansPack.headers;
  const iThucTe = h.findIndex((x) => x === "ThucTe");
  const iTrangThai = h.findIndex((x) => x === "TrangThai");
  const iNgayCN = h.findIndex((x) => x === "NgayCapNhat");
  if (iThucTe < 0) {
    throw new Error("Sheet KHSANLUONG thiếu cột ThucTe");
  }

  const batch: Array<{ range: string; values: (string | number)[][] }> = [];
  let updated = 0;
  let skipped = 0;
  const samples: Array<{ id: string; thucTe: number; status: string }> = [];

  for (const r of plansPack.rows) {
    const id = pick(r, ["ID_KeHoach"]);
    if (!id) {
      skipped += 1;
      continue;
    }
    const status = pick(r, ["TrangThai"]);
    if (status.includes("Hủy")) {
      skipped += 1;
      continue;
    }
    const ncc = pick(r, ["MaNCC"]).toUpperCase();
    const from = ymdDate(pick(r, ["TuNgay"])) || "";
    const den = ymdDate(pick(r, ["DenNgay"])) || "";
    const end = !den ? yesterday : den < yesterday ? den : yesterday;
    if (!from || !end || from > end) {
      // kỳ chưa có ngày nhận hợp lệ
      skipped += 1;
      continue;
    }
    const hhSet = new Set(
      pick(r, ["DanhSachHH"])
        .split(";")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    );
    if (!ncc || !hhSet.size) {
      skipped += 1;
      continue;
    }

    let sum = 0;
    for (const c of ctHits) {
      if (c.ncc !== ncc) continue;
      if (!hhSet.has(c.hh)) continue;
      if (c.ymd < from || c.ymd > end) continue;
      sum += c.qty;
    }
    sum = qty3(sum);
    const planned = num(pick(r, ["SoLuongKeHoach"]));
    const nextStatus = computePlanStatus({
      status,
      toDate: den,
      plannedQuantity: planned,
      actualQuantity: sum,
    });
    const oldTe = num(pick(r, ["ThucTe"]));
    if (Math.abs(oldTe - sum) < 1e-6 && nextStatus === status) {
      skipped += 1;
      continue;
    }

    const rowNum = r.__row;
    if (iThucTe >= 0) {
      batch.push({
        range: `${SHEETS.KHSL}!${colLetter(iThucTe)}${rowNum}`,
        values: [[sum]],
      });
    }
    if (iTrangThai >= 0) {
      batch.push({
        range: `${SHEETS.KHSL}!${colLetter(iTrangThai)}${rowNum}`,
        values: [[nextStatus]],
      });
    }
    if (iNgayCN >= 0) {
      batch.push({
        range: `${SHEETS.KHSL}!${colLetter(iNgayCN)}${rowNum}`,
        values: [[formatDateTimeVN()]],
      });
    }
    updated += 1;
    if (samples.length < 20) {
      samples.push({ id, thucTe: sum, status: nextStatus });
    }
  }

  await batchUpdateValues(y, batch);
  invalidateSheetCache([SHEETS.KHSL], y);

  await writeAudit({
    email: user.email,
    role: user.role,
    action: "ADMIN_CAP_NHAT_THUC_TE_KH",
    targetId: String(y),
    newValue: { updated, skipped, samples, yesterday },
    year: y,
  }).catch(() => null);

  return {
    success: true,
    year: y,
    yesterday,
    updated,
    skipped,
    samples,
    message: "ThucTe = SUM(CT.ThucNhan) theo NCC+HH, kỳ [TuNgay, min(DenNgay, hết hôm qua)].",
  };
}

// ─── repairAllOrderStatuses (3 bước) ─────────────────────────

export async function repairAllOrderStatuses(user: UserContext, year?: number) {
  throttleOrThrow("repairAllOrderStatuses");
  const y = year ?? currentYearVN();

  const [ctPack, ghRows, hhRows, dhRows] = await Promise.all([
    loadSheetWithRowIndex(SHEETS.CT, y),
    readSheetAsObjects(SHEETS.GH, { year: y, noCache: true }),
    readSheetAsObjects(SHEETS.HH, { year: y }),
    readSheetAsObjects(SHEETS.DH, { year: y, noCache: true }),
  ]);

  // HH hao hụt map
  const haohut = new Map<string, number>();
  for (const r of hhRows) {
    const id = pick(r, ["MaHH"]).toUpperCase();
    if (!id) continue;
    haohut.set(id, num(pick(r, ["TyleHaohut", "TyleHaoHut", "tyleHaohut"])));
  }

  // GH totals by ID_Chitiet
  const sumKh = new Map<string, number>();
  const sumTg = new Map<string, number>();
  for (const g of ghRows) {
    if (isGhDeleted(g)) continue;
    const idCt = pick(g, ["ID_Chitiet"]);
    if (!idCt) continue;
    sumKh.set(idCt, (sumKh.get(idCt) || 0) + num(pick(g, ["KHgiao", "KHGiao"])));
    sumTg.set(idCt, (sumTg.get(idCt) || 0) + num(pick(g, ["ThucGiao"])));
  }

  const h = ctPack.headers;
  const iSoLuong = h.findIndex((x) => x === "SoLuong");
  const iTrangThai = h.findIndex((x) => x === "TrangThaiXe");
  const iTime = h.findIndex((x) => x === "TimeChange");

  const batch: Array<{ range: string; values: (string | number)[][] }> = [];
  let detailFixed = 0;
  const detailSamples: string[] = [];

  for (const r of ctPack.rows) {
    const idCt = pick(r, ["ID_Chitiet"]);
    if (!idCt) continue;
    const st = pick(r, ["TrangThaiXe", "TrangThai"]);
    if (isDeleteCt(st)) continue;

    // (1) SoLuong = tổng KHgiao active
    const kh = qty3(sumKh.get(idCt) || 0);
    const oldSl = num(pick(r, ["SoLuong"]));
    let changed = false;
    if (iSoLuong >= 0 && Math.abs(oldSl - kh) > 1e-6 && kh > 0) {
      // Chỉ ghi đè khi có GH; nếu không GH giữ SL
      batch.push({
        range: `${SHEETS.CT}!${colLetter(iSoLuong)}${r.__row}`,
        values: [[kh]],
      });
      changed = true;
    }

    // (2) TrangThaiXe theo ThucNhan / ThucGiao + hao hụt
    const tn = num(pick(r, ["ThucNhan"]));
    const tg = qty3(sumTg.get(idCt) || 0);
    const hh = pick(r, ["MaHH"]).toUpperCase();
    const tl = haohut.get(hh) || 0;
    let nextSt = st;
    if (!isCancelCt(st)) {
      if (tn > 0) {
        if (tg <= 0) nextSt = STATUS_CT.RECEIVED;
        else if (validateTolerance(tn, tg, tl)) nextSt = STATUS_CT.DONE;
        else if (tg < tn) nextSt = STATUS_CT.DELIVERING;
        else nextSt = STATUS_CT.DONE; // giao ≥ nhận ngoài tol vẫn DONE? V21: tol → DONE else DELIVERING if tg < tn
      }
    }
    if (nextSt !== st && iTrangThai >= 0) {
      batch.push({
        range: `${SHEETS.CT}!${colLetter(iTrangThai)}${r.__row}`,
        values: [[nextSt]],
      });
      changed = true;
    }
    if (changed && iTime >= 0) {
      batch.push({
        range: `${SHEETS.CT}!${colLetter(iTime)}${r.__row}`,
        values: [[formatDateTimeVN()]],
      });
    }
    if (changed) {
      detailFixed += 1;
      if (detailSamples.length < 30) detailSamples.push(idCt);
    }
  }

  await batchUpdateValues(y, batch);
  invalidateSheetCache([SHEETS.CT, SHEETS.GH], y);

  // (3) Trạng thái đơn
  let orderOk = 0;
  let orderFail = 0;
  const orderSample: Array<{ orderId: string; status: string }> = [];
  for (const r of dhRows) {
    const orderId = pick(r, ["MaDon"]);
    if (!orderId) continue;
    try {
      const res = await syncOrderStatusByOrderId(orderId, y);
      orderOk += 1;
      if (orderSample.length < 30) {
        orderSample.push({ orderId, status: res.status });
      }
    } catch {
      orderFail += 1;
    }
  }
  invalidateSheetCache([SHEETS.DH], y);

  await writeAudit({
    email: user.email,
    role: user.role,
    action: "ADMIN_REPAIR_ORDER_STATUS",
    targetId: String(y),
    newValue: { detailFixed, orderOk, orderFail },
    year: y,
  }).catch(() => null);

  return {
    success: true,
    year: y,
    detailFixed,
    detailSamples,
    orders: dhRows.length,
    orderOk,
    orderFail,
    orderSample,
    message:
      "3 bước: (1) CT.SoLuong ← Σ KHgiao active (2) TrangThaiXe theo ThucNhan/ThucGiao+hao hụt (3) TrangThaiDon.",
  };
}

// ─── repairOrderedDetailsForSentOrders ──────────────────────

export async function repairOrderedDetailsForSentOrders(
  user: UserContext,
  year?: number
) {
  throttleOrThrow("repairOrderedDetailsForSentOrders");
  const y = year ?? currentYearVN();
  const [dh, ctPack] = await Promise.all([
    readSheetAsObjects(SHEETS.DH, { year: y, noCache: true }),
    loadSheetWithRowIndex(SHEETS.CT, y),
  ]);

  const sent = new Set<string>();
  for (const r of dh) {
    if (isOrderSent(r)) sent.add(pick(r, ["MaDon"]).toUpperCase());
  }

  const iTrangThai = ctPack.headers.findIndex((x) => x === "TrangThaiXe");
  const iTime = ctPack.headers.findIndex((x) => x === "TimeChange");
  const batch: Array<{ range: string; values: (string | number)[][] }> = [];
  let fixed = 0;
  const samples: string[] = [];

  for (const r of ctPack.rows) {
    const detailId = pick(r, ["ID_Chitiet"]);
    const orderId = pick(r, ["MaDon"]).toUpperCase();
    const st = pick(r, ["TrangThaiXe", "TrangThai"]);
    if (!detailId || !orderId) continue;
    if (isDeleteCt(st) || isCancelCt(st)) continue;
    if (!isNewCt(st)) continue;
    if (!sent.has(orderId)) continue;
    if (iTrangThai >= 0) {
      batch.push({
        range: `${SHEETS.CT}!${colLetter(iTrangThai)}${r.__row}`,
        values: [[STATUS_CT.ORDERED]],
      });
    }
    if (iTime >= 0) {
      batch.push({
        range: `${SHEETS.CT}!${colLetter(iTime)}${r.__row}`,
        values: [[formatDateTimeVN()]],
      });
    }
    fixed += 1;
    if (samples.length < 30) samples.push(detailId);
  }

  await batchUpdateValues(y, batch);
  invalidateSheetCache([SHEETS.CT], y);

  await writeAudit({
    email: user.email,
    role: user.role,
    action: "ADMIN_REPAIR_ORDERED_CT",
    targetId: String(y),
    newValue: { fixed, samples },
    year: y,
  }).catch(() => null);

  return { success: true, year: y, fixed, samples };
}

// ─── cache / schema ─────────────────────────────────────────

export async function checkCacheHealth() {
  const stats = sheetCacheStats();
  const ttlMs = Number(process.env.SHEET_CACHE_TTL_MS || 45000);
  const entries = Number(stats.size || 0);
  const warnings: string[] = [];
  if (entries > 40) warnings.push(`Nhiều cache entry (${entries}) trên instance này`);
  if (ttlMs === 0) warnings.push("SHEET_CACHE_TTL_MS=0 — cache đang tắt");
  return {
    success: true,
    kind: "instance-cache",
    stats,
    ttlMs,
    warnings,
    note:
      "Đây là cache RAM instance Vercel, không đo KB từng sheet như checkCacheHealth GAS.",
  };
}

export async function clearAllSheetCache() {
  invalidateSheetCache();
  return {
    success: true,
    message:
      "Đã xoá sheet cache trên instance hiện tại. Instance khác giữ cache tối đa TTL (~45s).",
  };
}

export async function validateStandardSchema(year?: number) {
  const y = year ?? currentYearVN();
  if (!isSheetsConfigured()) {
    return { success: false, error: "Chưa cấu hình Sheets" };
  }
  const results: Array<{
    sheet: string;
    ok: boolean;
    missing: string[];
    extra: string[];
    actualCount: number;
    expectedCount: number;
  }> = [];

  for (const [name, expected] of Object.entries(STANDARD_HEADERS)) {
    try {
      const actual = await readSheetHeaders(name, y);
      const actSet = new Set(actual.filter(Boolean));
      const missing = expected.filter((h) => !actSet.has(h));
      const expSet = new Set(expected);
      const extra = actual.filter((h) => h && !expSet.has(h));
      results.push({
        sheet: name,
        ok: missing.length === 0,
        missing,
        extra: extra.slice(0, 30),
        actualCount: actual.filter(Boolean).length,
        expectedCount: expected.length,
      });
    } catch {
      results.push({
        sheet: name,
        ok: false,
        missing: [...expected],
        extra: [],
        actualCount: 0,
        expectedCount: expected.length,
      });
    }
  }
  const bad = results.filter((r) => !r.ok);
  return {
    success: true,
    year: y,
    sheetsChecked: results.length,
    sheetsOk: results.length - bad.length,
    sheetsBad: bad.length,
    results,
  };
}

/** Bổ sung header thiếu vào cuối dòng 1 (không xoá cột thừa) */
export async function setupStandardSchema(user: UserContext, year?: number) {
  throttleOrThrow("setupStandardSchema");
  const y = year ?? currentYearVN();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(y);
  const fixed: Array<{ sheet: string; added: string[] }> = [];

  for (const [name, expected] of Object.entries(STANDARD_HEADERS)) {
    let actual: string[] = [];
    try {
      actual = await readSheetHeaders(name, y);
    } catch {
      // sheet có thể chưa tồn tại — bỏ qua (không tạo sheet mới ở phase này)
      continue;
    }
    const actSet = new Set(actual.filter(Boolean));
    const missing = expected.filter((h) => !actSet.has(h));
    if (!missing.length) continue;

    // Ghi header mới vào các cột tiếp theo trên dòng 1
    const startCol = actual.length; // 0-based next empty-ish
    // Nếu actual có hole, append sau max index
    const range = `${name}!${colLetter(startCol)}1`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [missing] },
    });
    fixed.push({ sheet: name, added: missing });
  }

  invalidateSheetCache();
  await writeAudit({
    email: user.email,
    role: user.role,
    action: "ADMIN_SETUP_SCHEMA",
    targetId: String(y),
    newValue: fixed,
    year: y,
  }).catch(() => null);

  return {
    success: true,
    year: y,
    fixed,
    message: fixed.length
      ? "Đã append header thiếu vào cuối dòng 1."
      : "Không có header thiếu (hoặc sheet không đọc được).",
  };
}

export async function purgeOldSystemCounters(
  user: UserContext,
  daysInput = 60,
  year?: number
) {
  const days = Math.max(7, Number(daysInput) || 60);
  const y = year ?? currentYearVN();
  const rows = await readSheetAsObjects(SHEETS.COUNTER, { year: y, noCache: true });
  const cutoff = Date.now() - days * 86400000;
  const old: Array<{ key: string; updatedAt: string }> = [];
  for (const r of rows) {
    const key = pick(r, ["Key", "KEY"]);
    if (!key || key.startsWith("__LOCK__")) continue;
    const ua = pick(r, ["UpdatedAt", "updatedAt"]);
    const t = Date.parse(ua);
    if (!Number.isNaN(t) && t < cutoff) old.push({ key, updatedAt: ua });
  }
  await writeAudit({
    email: user.email,
    role: user.role,
    action: "ADMIN_PURGE_COUNTERS_DRY",
    targetId: String(days),
    newValue: { count: old.length },
    year: y,
  }).catch(() => null);

  return {
    success: true,
    mode: "dry-run",
    days,
    candidates: old.length,
    sample: old.slice(0, 40),
    message:
      "Dry-run (mặc định 60 ngày, tối thiểu 7, bỏ __LOCK__*). Xoá hàng thật: dùng GAS purgeOldSystemCounters hoặc phase delete-row sau.",
  };
}

export async function normalizeLegacyDeliveryIdsDryRun(year?: number) {
  const y = year ?? currentYearVN();
  const rows = await readSheetAsObjects(SHEETS.GH, { year: y });
  const bad: Array<{ id: string; detailId: string }> = [];
  for (const r of rows) {
    const id = pick(r, ["ID_Giaohang", "ID_GiaoHang"]);
    if (!id) continue;
    if (!isStandardGhId(id)) {
      bad.push({ id, detailId: pick(r, ["ID_Chitiet"]) });
    }
  }
  return {
    success: true,
    year: y,
    total: rows.length,
    legacyCount: bad.length,
    sample: bad.slice(0, 50),
    message: "Dry-run — isStandardGhId = /^GH-\\d{6}-\\d{4}$/i",
  };
}

export async function normalizeLegacyDeliveryIdsApply(
  user: UserContext,
  year?: number
) {
  const y = year ?? currentYearVN();
  const dry = await normalizeLegacyDeliveryIdsDryRun(y);
  await writeAudit({
    email: user.email,
    role: user.role,
    action: "ADMIN_NORMALIZE_GH_ID_SKIP",
    targetId: String(y),
    newValue: { legacyCount: dry.legacyCount },
    year: y,
  }).catch(() => null);
  return {
    success: true,
    applied: 0,
    year: y,
    legacyCount: dry.legacyCount,
    sample: dry.sample,
    message:
      "Chưa apply trên Vercel (đổi key ID_Giaohang cần lock + _newDeliveryId_ như GAS). Chạy normalizeLegacyDeliveryIdsApply trên GAS V21.",
  };
}

export type AdminSystemAction =
  | "stats"
  | "capNhatThucTeKeHoach"
  | "repairAllOrderStatuses"
  | "repairDataDrift"
  | "repairOrderedDetailsForSentOrders"
  | "checkCacheHealth"
  | "clearMasterCache"
  | "validateStandardSchema"
  | "setupStandardSchema"
  | "purgeOldSystemCounters"
  | "normalizeLegacyDeliveryIdsDryRun"
  | "normalizeLegacyDeliveryIdsApply";

export async function runAdminSystemAction(
  action: AdminSystemAction,
  user: UserContext,
  opts?: { year?: number; days?: number }
) {
  const year = opts?.year ?? currentYearVN();
  switch (action) {
    case "stats":
      return { success: true, data: await getAdminStats(year) };
    case "capNhatThucTeKeHoach":
      return await capNhatThucTeKeHoach(user, year);
    case "repairAllOrderStatuses":
    case "repairDataDrift":
      return await repairAllOrderStatuses(user, year);
    case "repairOrderedDetailsForSentOrders":
      return await repairOrderedDetailsForSentOrders(user, year);
    case "checkCacheHealth":
      return await checkCacheHealth();
    case "clearMasterCache":
      return await clearAllSheetCache();
    case "validateStandardSchema":
      return await validateStandardSchema(year);
    case "setupStandardSchema":
      return await setupStandardSchema(user, year);
    case "purgeOldSystemCounters":
      return await purgeOldSystemCounters(user, opts?.days ?? 60, year);
    case "normalizeLegacyDeliveryIdsDryRun":
      return await normalizeLegacyDeliveryIdsDryRun(year);
    case "normalizeLegacyDeliveryIdsApply":
      return await normalizeLegacyDeliveryIdsApply(user, year);
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
