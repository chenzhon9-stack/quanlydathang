/**
 * Phân bổ lại KHgiao khi nhận hàng — parity V21 `_phanBoLaiKeHoachGiao_`.
 *  - 1 dòng GH: gán thẳng = thực nhận (làm tròn theo bước chia hết).
 *  - Nhiều dòng: khách THẬT nhân tỷ lệ thực nhận / tổng KH cũ, làm tròn theo bước;
 *    dòng khách ĐỆM (acghang / acghangB / acghangR) nhận phần còn lại.
 *    Không có dòng đệm → dòng khách thật cuối cùng đóng vai trò đệm (như GAS).
 */
import { qty3 } from "@/lib/business-rules";
import { isAcghangId } from "@/lib/default-plan-kh";

export type ReallocRow = { id: string; customerId: string; planned: number };

/** Trả Map<id, KHgiao mới> chỉ gồm các dòng có KH thay đổi; null nếu không cần/không thể phân bổ. */
export function reallocatePlanOnReceive(
  rows: ReallocRow[],
  thucNhan: number,
  step: number
): Map<string, number> | null {
  if (!rows.length || !(thucNhan > 0)) return null;
  const round = (v: number) =>
    step > 0 ? qty3(Math.round(v / step) * step) : qty3(v);

  const tong = qty3(rows.reduce((s, r) => s + (Number(r.planned) || 0), 0));
  if (tong === 0) return null;
  if (Math.abs(tong - thucNhan) < 0.0001) return null;

  const out = new Map<string, number>();
  const push = (r: ReallocRow, v: number) => {
    if (Math.abs(v - (Number(r.planned) || 0)) > 0.0001) out.set(r.id, v);
  };

  if (rows.length === 1) {
    push(rows[0], round(thucNhan));
    return out;
  }

  let buffer: ReallocRow | null = null;
  const real: ReallocRow[] = [];
  for (const r of rows) {
    if (isAcghangId(r.customerId) && !buffer) buffer = r;
    else real.push(r);
  }
  if (!buffer && real.length > 0) buffer = real.pop()!;
  if (!buffer) return null;

  const tyLe = thucNhan / tong;
  let assigned = 0;
  const assigns: Array<{ r: ReallocRow; v: number }> = [];
  for (const r of real) {
    const v = round((Number(r.planned) || 0) * tyLe);
    assigns.push({ r, v });
    assigned += v;
  }
  let bufferVal = round(thucNhan - assigned);
  const diff = qty3(thucNhan - (assigned + bufferVal));
  if (Math.abs(diff) > 0.0001) bufferVal = round(bufferVal + diff);
  if (bufferVal < 0) bufferVal = 0;
  assigns.push({ r: buffer, v: bufferVal });

  for (const a of assigns) push(a.r, a.v);
  return out;
}
