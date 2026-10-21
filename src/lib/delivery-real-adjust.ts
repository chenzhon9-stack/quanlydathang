/**
 * Điều chỉnh danh sách giao thực tế — port từ V21.07 `saveDeliveryData` (realMode):
 *   1. Tìm dòng thay đổi (|TG − KHgiao cũ| lớn nhất, chỉ khách THẬT)
 *   2. over / under: rút từ / đẩy vào dòng pending (ưu tiên khách đệm acghang/B/R)
 *      + xác nhận từng dòng (needConfirm) như GAS
 *   3. Case 7: gom dòng pending nhỏ (< tlHH × ThucNhan) vào dòng đang giao
 *   4. Bù sai số làm tròn: Σ KHgiao = ThucNhan (đệm trước, khách thật cuối)
 *   5. Lọc dòng rỗng (KH=0 & TG=0, trừ đệm còn kế hoạch / dòng đã có mã)
 *
 * Thuần hàm — không đọc Sheet. Ném `{ code, message, needConfirm? }` như service.
 */
import { isAcghangId } from "@/lib/default-plan-kh";

export type AdjustRow = {
  deliveryId: string;
  customerId: string;
  customerDetail: string;
  plannedQty: number;
  actualQty: number;
  deliveryDate: string;
  note: string;
  isNew: boolean;
};

export type AdjustCtx = {
  thucNhan: number;
  /** TyleChiahet (bước làm tròn); 0 = không làm tròn theo bước */
  step: number;
  /** TyleHaohut dạng phân số (0.01 = 1%) */
  tlHH: number;
  /** KHgiao hiện có trên Sheet theo deliveryId */
  oldKhById: Map<string, number>;
  /** mã khách đệm ưu tiên theo PhanLoaiHH (acghangB / acghangR / acghang) */
  preferBufferId: string;
  /** khách không phải THẬT (LoaiKhach VIRTUAL/SYSTEM) — lowercase; acghang* luôn là không thật */
  nonRealSet: Set<string>;
  confirmFinish?: boolean;
  adminOverride?: boolean;
  isAdmin?: boolean;
};

const qty3 = (v: number) => Math.round((Number(v) || 0) * 1000) / 1000;
const q2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

function needConfirm(message: string): never {
  throw { code: "NEED_CONFIRM", message, needConfirm: true };
}

export function adjustRealList(input: AdjustRow[], ctx: AdjustCtx): AdjustRow[] {
  let list = input.map((r) => ({ ...r }));
  const { thucNhan, step, tlHH } = ctx;

  const isReal = (id: string) => {
    const k = String(id || "").trim().toLowerCase();
    return !!k && !isAcghangId(k) && !ctx.nonRealSet.has(k);
  };
  const isBuf = (id: string) => isAcghangId(id);
  const roundStep = (v: number) => {
    if (step > 1e-9) return q2(Math.round(v / step) * step);
    return q2(v);
  };

  const buffersPreferred = () => {
    const prefer = ctx.preferBufferId.toLowerCase();
    return list
      .filter((x) => isBuf(x.customerId))
      .sort((a, b) => {
        const aa = a.customerId.toLowerCase() === prefer ? 0 : 1;
        const bb = b.customerId.toLowerCase() === prefer ? 0 : 1;
        return aa - bb;
      });
  };

  const pullFromPending = (amount: number): number => {
    let remaining = amount;
    let pulled = 0;
    for (const acg of buffersPreferred()) {
      if (remaining <= 0.0001) break;
      const avail = acg.plannedQty;
      if (avail > 0) {
        const take = Math.min(avail, remaining);
        const newKh = Math.max(0, roundStep(avail - take));
        const taken = q2(avail - newKh);
        acg.plannedQty = newKh;
        pulled += taken;
        remaining -= taken;
      }
    }
    if (remaining > 0.0001) {
      const pend = list.filter(
        (x) => isReal(x.customerId) && x.actualQty === 0
      );
      for (const p of pend) {
        if (remaining <= 0.0001) break;
        const avail = p.plannedQty;
        if (avail <= 0) continue;
        const take = Math.min(avail, remaining);
        const newKh = Math.max(0, roundStep(avail - take));
        const taken = q2(avail - newKh);
        p.plannedQty = newKh;
        pulled += taken;
        remaining -= taken;
      }
    }
    return q2(pulled);
  };

  const newBuffer = (amount: number): AdjustRow => ({
    deliveryId: `NEW-acg-${Date.now()}`,
    customerId: ctx.preferBufferId,
    customerDetail: "",
    plannedQty: roundStep(amount),
    actualQty: 0,
    deliveryDate: "",
    note: "Điều chỉnh kế hoạch",
    isNew: true,
  });

  const pushToPending = (amount: number) => {
    if (amount <= 0.0001) return;
    const acg = buffersPreferred()[0];
    if (acg) {
      acg.plannedQty = roundStep(acg.plannedQty + amount);
      return;
    }
    const pending = list.filter(
      (x) => isReal(x.customerId) && x.actualQty === 0
    );
    if (pending.length > 0) {
      pending[0].plannedQty = roundStep(pending[0].plannedQty + amount);
      return;
    }
    list.push(newBuffer(amount));
  };

  // ===== 1. Dòng đang thay đổi (khách thật có TG > 0, delta lớn nhất) =====
  const delivered = list.filter((x) => isReal(x.customerId) && x.actualQty > 0);
  let changed: AdjustRow | null = null;
  let oldKh = 0;
  let newTg = 0;
  let maxDelta = 0;
  for (const item of delivered) {
    const id = item.deliveryId;
    const old =
      !item.isNew && id && ctx.oldKhById.has(id)
        ? Number(ctx.oldKhById.get(id)) || 0
        : 0;
    const delta = Math.abs(item.actualQty - old);
    if (delta > 0.0001 && delta > maxDelta) {
      maxDelta = delta;
      changed = item;
      oldKh = old;
      newTg = item.actualQty;
    }
  }

  if (changed) {
    const delta = q2(newTg - oldKh);
    const totalTgAfter = delivered.reduce((s, x) => s + x.actualQty, 0);
    const perLineRatio = Math.abs(delta) / thucNhan;
    const isSmall = perLineRatio <= tlHH + 1e-9;
    const totalOverRatio = (totalTgAfter - thucNhan) / thucNhan;

    if (delta > 0) {
      if (totalTgAfter >= thucNhan - 0.0001) {
        if (totalOverRatio <= tlHH + 1e-9) {
          if (!ctx.confirmFinish) {
            needConfirm(
              `Tổng thực giao (${totalTgAfter.toFixed(2)}) vượt thực nhận (${thucNhan.toFixed(2)}) ${(totalOverRatio * 100).toFixed(1)}%, trong ngưỡng cho phép ${(tlHH * 100).toFixed(0)}%.\nBạn xác nhận lưu?`
            );
          }
        } else {
          if (!ctx.isAdmin) {
            throw {
              code: "VALIDATION_ERROR",
              message: `Tổng thực giao vượt thực nhận ${(totalOverRatio * 100).toFixed(1)}%, vượt ngưỡng cho phép ${(tlHH * 100).toFixed(0)}%. Vui lòng liên hệ admin để xử lý.`,
            };
          }
          if (!ctx.adminOverride) {
            needConfirm(
              `Tổng thực giao vượt ngưỡng ${(tlHH * 100).toFixed(0)}% cho phép (hiện tại vượt ${(totalOverRatio * 100).toFixed(1)}%).\nBạn xác nhận lưu với vai trò Admin?`
            );
          }
        }
        const pulled = pullFromPending(delta);
        changed.plannedQty = roundStep(oldKh + pulled);
      } else if (isSmall) {
        // Case 3: lệch nhẹ, tổng vẫn < thực nhận → chỉ xác nhận, không điều chỉnh
        if (!ctx.confirmFinish) {
          needConfirm(
            `Thực giao (${newTg.toFixed(2)}) chênh lệch nhẹ so với kế hoạch (${oldKh.toFixed(2)}).\nBạn xác nhận lưu?`
          );
        }
      } else {
        // Case 4: over lớn, tổng < thực nhận
        if (!ctx.confirmFinish) {
          needConfirm(
            `Thực giao (${newTg.toFixed(2)}) vượt kế hoạch (${oldKh.toFixed(2)}) quá ngưỡng ${(tlHH * 100).toFixed(0)}%.\nBạn xác nhận lưu?`
          );
        }
        const pulled = pullFromPending(delta);
        changed.plannedQty = roundStep(oldKh + pulled);
      }
    } else {
      const freed = q2(oldKh - newTg);
      if (isSmall) {
        if (!ctx.confirmFinish) {
          needConfirm(
            `Thực giao (${newTg.toFixed(2)}) thấp hơn kế hoạch (${oldKh.toFixed(2)}) một chút.\nBạn xác nhận lưu?`
          );
        }
      } else {
        if (!ctx.confirmFinish) {
          needConfirm(
            `Thực giao (${newTg.toFixed(2)}) thấp hơn kế hoạch (${oldKh.toFixed(2)}) quá ngưỡng ${(tlHH * 100).toFixed(0)}%.\nBạn xác nhận lưu?`
          );
        }
        changed.plannedQty = roundStep(newTg);
        pushToPending(freed);
      }
    }

    // ===== 3. Case 7: gom dòng pending nhỏ =====
    const smallThreshold = tlHH * thucNhan;
    if (smallThreshold > 0) {
      const pendingItems = list.filter(
        (x) => x.actualQty === 0 && x.plannedQty > 0
      );
      let totalSmall = 0;
      const small: AdjustRow[] = [];
      for (const p of pendingItems) {
        if (p.plannedQty < smallThreshold) {
          totalSmall += p.plannedQty;
          small.push(p);
        }
      }
      if (totalSmall > 0.0001) {
        let target: AdjustRow | null = changed;
        if (!target) {
          const dl = list.filter((x) => x.actualQty > 0);
          if (dl.length) {
            target = dl.reduce((a, b) => (a.plannedQty > b.plannedQty ? a : b));
          }
        }
        if (!target) {
          let acg = buffersPreferred()[0];
          if (!acg) {
            acg = newBuffer(0);
            list.push(acg);
          }
          target = acg;
        }
        target.plannedQty = roundStep(target.plannedQty + totalSmall);
        small.forEach((p) => {
          p.plannedQty = 0;
        });
      }
    }
  }

  // ===== 4. Bù sai số làm tròn — luôn chạy =====
  const totalKh = list.reduce((s, x) => s + x.plannedQty, 0);
  const diff = q2(totalKh - thucNhan);
  if (Math.abs(diff) > 0.0001) {
    let adjust: AdjustRow | undefined = buffersPreferred().find(
      (x) => x.plannedQty - diff >= -0.0001
    );
    if (!adjust) {
      const cands = list.filter(
        (x) => isReal(x.customerId) && x.plannedQty - diff >= -0.0001
      );
      if (cands.length) adjust = cands[cands.length - 1];
    }
    if (adjust) {
      adjust.plannedQty = Math.max(0, roundStep(adjust.plannedQty - diff));
    } else if (Math.abs(diff) > (step > 1e-9 ? step : 0.01)) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Tổng kế hoạch (${totalKh.toFixed(2)}) khác thực nhận (${thucNhan.toFixed(2)}) và không thể tự động điều chỉnh. Vui lòng kiểm tra lại.`,
      };
    }
  }

  // ===== 5. Lọc dòng không cần thiết =====
  list = list.filter((x) => {
    if (!x.isNew && x.deliveryId) return true;
    if (isAcghangId(x.customerId) && x.plannedQty > 0) return true;
    return !(x.plannedQty === 0 && x.actualQty === 0);
  });

  // chuẩn hóa số
  return list.map((x) => ({
    ...x,
    plannedQty: qty3(x.plannedQty),
    actualQty: qty3(x.actualQty),
  }));
}
