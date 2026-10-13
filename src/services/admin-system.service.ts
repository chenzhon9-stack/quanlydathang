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
  appendSheetRow,
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
import { postGasWebhook, gasWebhookUrl } from "@/lib/gas-webhook";

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


// ─── System_Config (parity GAS Script Properties) ───────────

const PROP_SECRET_RE = /(SECRET|TOKEN|SALT|PASSWORD|API_?KEY|_KEY$|PRIVATE)/i;
const PROP_MASK = "********";

export function isSecretPropKey(key: string): boolean {
  return PROP_SECRET_RE.test(String(key || ""));
}

export function maskPropValue(key: string, value: string): string {
  if (value == null || value === "") return "";
  if (isSecretPropKey(key)) return PROP_MASK;
  if (/URL|WEBHOOK/i.test(key) && String(value).length > 28) {
    return String(value).slice(0, 24) + "…";
  }
  return String(value);
}

/** Env runtime — chỉ đọc từ process.env */
const ENV_PROP_KEYS = [
  "NODE_ENV",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_SHEETS_SPREADSHEET_ID_2025",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GAS_SEND_ORDER_URL",
  "GAS_WEBHOOK_SECRET",
  "AUTH_SECRET",
  "SECRET_SALT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SHEET_CACHE_TTL_MS",
  "ALLOW_MOCK_LOGIN",
  "ALLOW_LEGACY_UNSIGNED_TOKEN",
] as const;

async function ensureSystemConfigSheet(year?: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets || [])
    .map((s) => s.properties?.title || "")
    .filter(Boolean);
  const headers = STANDARD_HEADERS[SHEETS.SYS_CONFIG] || [
    "Key",
    "Value",
    "GhiChu",
    "UpdatedAt",
    "UpdatedBy",
  ];
  if (!titles.includes(SHEETS.SYS_CONFIG)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEETS.SYS_CONFIG } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.SYS_CONFIG}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    invalidateSheetCache(SHEETS.SYS_CONFIG, year);
    return;
  }
  const h = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEETS.SYS_CONFIG}!1:1`,
  });
  if (!(h.data.values || [])[0]?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.SYS_CONFIG}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    invalidateSheetCache(SHEETS.SYS_CONFIG, year);
  }
}

export type SystemPropItem = {
  key: string;
  value: string;
  displayValue: string;
  source: "env" | "sheet" | "gas";
  readOnly: boolean;
  isSecret: boolean;
  ghiChu?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export async function listSystemProperties(
  year?: number,
  userEmail?: string
): Promise<{
  items: SystemPropItem[];
  sheetReady: boolean;
  gasReady: boolean;
  gasError?: string;
}> {
  const items: SystemPropItem[] = [];

  // (A) Vercel env — chỉ đọc
  for (const k of ENV_PROP_KEYS) {
    const raw = process.env[k];
    if (raw === undefined || raw === "") continue;
    items.push({
      key: k,
      value: "",
      displayValue: maskPropValue(k, raw),
      source: "env",
      readOnly: true,
      isSecret: isSecretPropKey(k),
      ghiChu: "Vercel Environment Variable (chỉ đọc)",
    });
  }

  // (C) GAS Script Properties — qua webhook
  let gasReady = false;
  let gasError: string | undefined;
  if (userEmail && gasWebhookUrl()) {
    try {
      const gasRes = await postGasWebhook(
        {
          action: "getSystemProperties",
          email: userEmail,
        },
        { timeoutMs: 20_000 }
      );
      const body = gasRes.body || {};
      if (body.success === true && body.properties && typeof body.properties === "object") {
        gasReady = true;
        const props = body.properties as Record<string, unknown>;
        for (const [key, rawVal] of Object.entries(props)) {
          const k = String(key || "").trim();
          if (!k) continue;
          const val = rawVal == null ? "" : String(rawVal);
          const secret = isSecretPropKey(k) || val === PROP_MASK;
          items.push({
            key: k,
            value: secret ? "" : val,
            displayValue: secret ? (val ? PROP_MASK : "") : val,
            source: "gas",
            readOnly: false,
            isSecret: secret,
            ghiChu: "GAS Script Properties",
          });
        }
      } else {
        gasError =
          String(body.error || body.message || "") ||
          `GAS HTTP ${gasRes.status}` ||
          "Không đọc được Script Properties";
        if (body._gasHtml) {
          gasError =
            "GAS trả HTML — kiểm tra doPost action getSystemProperties + Deploy New version";
        }
      }
    } catch (e) {
      gasError = e instanceof Error ? e.message : String(e);
      console.error("[listSystemProperties] GAS", e);
    }
  } else if (userEmail && !gasWebhookUrl()) {
    gasError = "Chưa cấu hình GAS_SEND_ORDER_URL — không gọi được Script Properties";
  }

  // (B) Sheet System_Config
  let sheetReady = false;
  try {
    if (isSheetsConfigured()) {
      await ensureSystemConfigSheet(year);
      sheetReady = true;
      const rows = await readSheetAsObjects(SHEETS.SYS_CONFIG, {
        year,
        noCache: true,
      });
      for (const r of rows) {
        const key = String(r.Key || r.key || "").trim();
        if (!key) continue;
        const val = String(r.Value ?? r.value ?? "");
        items.push({
          key,
          value: isSecretPropKey(key) ? "" : val,
          displayValue: maskPropValue(key, val),
          source: "sheet",
          readOnly: false,
          isSecret: isSecretPropKey(key),
          ghiChu: String(r.GhiChu || "") || undefined,
          updatedAt: String(r.UpdatedAt || "") || undefined,
          updatedBy: String(r.UpdatedBy || "") || undefined,
        });
      }
    }
  } catch (e) {
    console.error("[listSystemProperties] sheet", e);
  }

  const sourceOrder: Record<string, number> = { env: 0, gas: 1, sheet: 2 };
  items.sort((a, b) => {
    const d = (sourceOrder[a.source] ?? 9) - (sourceOrder[b.source] ?? 9);
    if (d !== 0) return d;
    return a.key.localeCompare(b.key);
  });
  return { items, sheetReady, gasReady, gasError };
}

/**
 * Cập nhật / thêm Script Property trên GAS (parity updateSystemProperty).
 * value === "********" → GAS giữ nguyên (unchanged).
 */
export async function updateGasSystemProperty(
  input: { key: string; value: string },
  user: UserContext
) {
  const key = String(input.key || "").trim();
  if (!key) throw { code: "VALIDATION", message: "Thiếu Key" };
  if (!gasWebhookUrl()) {
    throw {
      code: "GAS_NOT_CONFIGURED",
      message: "Chưa cấu hình GAS_SEND_ORDER_URL",
    };
  }
  const value = String(input.value ?? "");
  const gasRes = await postGasWebhook(
    {
      action: "updateSystemProperty",
      email: user.email,
      key,
      value,
    },
    { timeoutMs: 20_000 }
  );
  const body = gasRes.body || {};
  if (body.success === true) {
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "GAS_PROP_UPSERT",
      targetId: key,
      newValue: {
        key,
        isSecret: isSecretPropKey(key),
        unchanged: Boolean(body.unchanged),
      },
    }).catch(() => null);
    return {
      success: true as const,
      key,
      source: "gas" as const,
      unchanged: Boolean(body.unchanged),
    };
  }
  const errMsg =
    String(body.error || body.message || "") ||
    (body._gasHtml
      ? "GAS trả HTML — bổ sung action updateSystemProperty trong doPost + Deploy"
      : `GAS HTTP ${gasRes.status}`);
  throw { code: "GAS_PROP_FAILED", message: errMsg };
}

export async function upsertSystemProperty(
  input: { key: string; value: string; ghiChu?: string },
  user: UserContext,
  year?: number
) {
  const key = String(input.key || "").trim();
  if (!key) throw { code: "VALIDATION", message: "Thiếu Key" };
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
    throw {
      code: "VALIDATION",
      message: "Key chỉ gồm chữ, số, _ ; bắt đầu bằng chữ",
    };
  }
  if ((ENV_PROP_KEYS as readonly string[]).includes(key)) {
    throw {
      code: "VALIDATION",
      message:
        "Key trùng biến môi trường Vercel — sửa trên Vercel Dashboard",
    };
  }
  let value = String(input.value ?? "");
  if (value === PROP_MASK || value === "********") {
    throw {
      code: "VALIDATION",
      message: "******** = không đổi — nhập giá trị mới",
    };
  }

  await ensureSystemConfigSheet(year);
  const rows = await readSheetAsObjects(SHEETS.SYS_CONFIG, {
    year,
    noCache: true,
  });
  const existing = rows.find(
    (r) => String(r.Key || "").trim().toUpperCase() === key.toUpperCase()
  );
  const now = formatDateTimeVN();
  const ghiChu = String(input.ghiChu ?? existing?.GhiChu ?? "").trim();

  if (existing) {
    let writeVal = value;
    if (isSecretPropKey(key) && !value) {
      writeVal = String(existing.Value ?? "");
    }
    await updateSheetRowByKey(
      SHEETS.SYS_CONFIG,
      "Key",
      String(existing.Key || key),
      {
        Value: writeVal,
        GhiChu: ghiChu,
        UpdatedAt: now,
        UpdatedBy: user.email,
      },
      year
    );
  } else {
    await appendSheetRow(
      SHEETS.SYS_CONFIG,
      {
        Key: key,
        Value: value,
        GhiChu: ghiChu,
        UpdatedAt: now,
        UpdatedBy: user.email,
      },
      year
    );
  }

  await writeAudit({
    email: user.email,
    role: user.role,
    action: "SYSTEM_PROP_UPSERT",
    targetId: key,
    newValue: { key, isSecret: isSecretPropKey(key), hasValue: Boolean(value) },
    year,
  }).catch(() => null);

  return { success: true, key };
}

export async function deleteSystemProperty(
  key: string,
  user: UserContext,
  year?: number
) {
  const k = String(key || "").trim();
  if (!k) throw { code: "VALIDATION", message: "Thiếu Key" };
  if ((ENV_PROP_KEYS as readonly string[]).includes(k)) {
    throw {
      code: "VALIDATION",
      message: "Không xóa biến môi trường Vercel từ đây",
    };
  }
  await ensureSystemConfigSheet(year);
  const rows = await readSheetAsObjects(SHEETS.SYS_CONFIG, {
    year,
    noCache: true,
  });
  const existing = rows.find(
    (r) => String(r.Key || "").trim().toUpperCase() === k.toUpperCase()
  );
  if (!existing) {
    throw { code: "NOT_FOUND", message: `Không thấy key ${k}` };
  }
  await updateSheetRowByKey(
    SHEETS.SYS_CONFIG,
    "Key",
    String(existing.Key || k),
    {
      Key: "",
      Value: "",
      GhiChu: `Deleted by ${user.email}`,
      UpdatedAt: formatDateTimeVN(),
      UpdatedBy: user.email,
    },
    year
  );
  await writeAudit({
    email: user.email,
    role: user.role,
    action: "SYSTEM_PROP_DELETE",
    targetId: k,
    year,
  }).catch(() => null);
  return { success: true, key: k };
}

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
