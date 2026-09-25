"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { DecimalInput, parseDecimalVN } from "@/components/DecimalInput";
import { apiPost } from "@/components/ActionPrompt";
import type { Order, OrderDetail, Delivery } from "@/types";

type GhRow = {
  key: string;
  idGh: string;
  isNew: boolean;
  customerId: string;
  customerName: string;
  customerDetail: string;
  plannedQty: string;
  actualQty: number;
};

type Block = {
  key: string;
  detailId: string;
  isNew: boolean;
  status: string;
  transportTypeId: string;
  transportTypeName: string;
  canChonDvt: boolean;
  carrierId: string;
  carrierName: string;
  vehicleId: string;
  vehicleName: string;
  productId: string;
  productName: string;
  regionId: string;
  regionName: string;
  note: string;
  actualReceived: number;
  deliveries: GhRow[];
};

function needsDvt(maHtvt: string, canChon: boolean) {
  const c = String(maHtvt || "").toUpperCase();
  return canChon || c === "THUE_NGOAI" || c.includes("THUE");
}

function emptyGh(): GhRow {
  return {
    key: `gh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    idGh: "",
    isNew: true,
    customerId: "",
    customerName: "",
    customerDetail: "",
    plannedQty: "",
    actualQty: 0,
  };
}

function emptyBlock(): Block {
  return {
    key: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    detailId: "",
    isNew: true,
    status: "Mới tạo",
    transportTypeId: "",
    transportTypeName: "",
    canChonDvt: false,
    carrierId: "",
    carrierName: "",
    vehicleId: "",
    vehicleName: "",
    productId: "",
    productName: "",
    regionId: "",
    regionName: "",
    note: "",
    actualReceived: 0,
    deliveries: [emptyGh()],
  };
}

type Props = {
  orderId: string | null;
  year?: number;
  onClose: () => void;
  onSaved?: () => void;
};

export function OrderManageModal({
  orderId,
  year = new Date().getFullYear(),
  onClose,
  onSaved,
}: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setErr(null);
    try {
      const token = localStorage.getItem("token");
      const headers = { Authorization: `Bearer ${token}` };
      const qs = `year=${year}`;
      const [ro, rd, rg] = await Promise.all([
        fetch(`/api/v1/orders/${encodeURIComponent(orderId)}?${qs}`, {
          headers,
        }),
        fetch(
          `/api/v1/order-details?orderId=${encodeURIComponent(orderId)}&${qs}&pageSize=100`,
          { headers }
        ),
        fetch(
          `/api/v1/deliveries?year=${year}&pageSize=200`,
          { headers }
        ),
      ]);
      const jo = await ro.json();
      const jd = await rd.json();
      const jg = await rg.json();
      if (!jo.success) throw new Error(jo.error?.message || "Không tải được đơn");
      const o = jo.data as Order;
      setOrder(o);
      const details: OrderDetail[] = jd.data?.items || jd.data || [];
      const allGh: Delivery[] = jg.data?.items || jg.data || [];
      const byCt = new Map<string, Delivery[]>();
      for (const g of allGh) {
        const id = String(g.detailId || "");
        if (!id) continue;
        if (!byCt.has(id)) byCt.set(id, []);
        byCt.get(id)!.push(g);
      }

      const mapped: Block[] = details
        .filter((d) => {
          const s = String(d.status || "");
          return !s.includes("Xóa");
        })
        .map((d) => {
          const ghs = byCt.get(d.detailId) || [];
          const activeGh = ghs.filter((g) => !g.deleted);
          return {
            key: d.detailId,
            detailId: d.detailId,
            isNew: false,
            status: String(d.status || ""),
            transportTypeId: (d as { transportTypeId?: string }).transportTypeId || "",
            transportTypeName: (d as { transportTypeName?: string }).transportTypeName || "",
            canChonDvt: false,
            carrierId: "",
            carrierName: "",
            vehicleId: d.vehicleId || "",
            vehicleName: d.vehiclePlate || d.vehicleId || "",
            productId: d.productId || "",
            productName: d.productName || d.productId || "",
            regionId: d.regionId || "",
            regionName: d.regionName || d.regionId || "",
            note: d.note || "",
            actualReceived: Number(d.actualReceived) || 0,
            deliveries:
              activeGh.length > 0
                ? activeGh.map((g) => ({
                    key: g.deliveryId,
                    idGh: g.deliveryId,
                    isNew: false,
                    customerId: g.customerId || "",
                    customerName: g.customerName || g.customerId || "",
                    customerDetail: g.customerDetail || "",
                    plannedQty: String(g.plannedQty ?? "").replace(".", ","),
                    actualQty: Number(g.actualQty) || 0,
                  }))
                : [emptyGh()],
          };
        });
      setBlocks(mapped.length ? mapped : [emptyBlock()]);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let plan = 0;
    let recv = 0;
    let del = 0;
    for (const b of blocks) {
      recv += Number(b.actualReceived) || 0;
      for (const g of b.deliveries) {
        plan += parseDecimalVN(g.plannedQty);
        del += Number(g.actualQty) || 0;
      }
    }
    return { plan, recv, del };
  }, [blocks]);

  const editable = useMemo(() => {
    if (!order) return false;
    const st = String(order.status || "");
    return (
      st === "NEW" ||
      st.includes("Khởi tạo") ||
      st === "PROCESSING" ||
      st.includes("Đang xử lý")
    );
  }, [order]);

  async function saveAll() {
    if (!order || !orderId) return;
    setErr(null);

    // Trùng xe+hàng
    const pairs = new Set<string>();
    for (const b of blocks) {
      const k = `${b.vehicleId}|${b.productId}`;
      if (b.vehicleId && b.productId) {
        if (pairs.has(k)) {
          setErr(
            `Trùng xe + hàng: ${b.vehicleName || b.vehicleId} / ${b.productName || b.productId}`
          );
          return;
        }
        pairs.add(k);
      }
      if (!b.vehicleId || !b.productId || !b.regionId) {
        setErr("Mỗi khối xe cần đủ biển số, hàng hóa, khu vực");
        return;
      }
      if (!b.transportTypeId) {
        setErr("Chọn hình thức vận tải cho mỗi xe");
        return;
      }
      if (needsDvt(b.transportTypeId, b.canChonDvt) && !b.carrierId && b.isNew) {
        setErr("Thuê ngoài — chọn đơn vị vận tải");
        return;
      }
      for (const g of b.deliveries) {
        if (!g.customerId || parseDecimalVN(g.plannedQty) <= 0) {
          setErr("Mỗi dòng KH cần khách và SL đặt > 0");
          return;
        }
      }
    }
    if (blocks.length > 6) {
      setErr("Tối đa 6 xe / đơn");
      return;
    }

    setBusy(true);
    try {
      const token = localStorage.getItem("token");
      const headers: HeadersInit = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      // 1) Xe mới → POST details
      const news = blocks.filter((b) => b.isNew);
      if (news.length) {
        const body = {
          year,
          details: news.map((d) => ({
            vehicleId: d.vehicleId,
            productId: d.productId,
            regionId: d.regionId,
            note: d.note,
            transportTypeId: d.transportTypeId || undefined,
            transportTypeName: d.transportTypeName || undefined,
            carrierId: d.carrierId || undefined,
            deliveries: d.deliveries.map((g) => ({
              customerId: g.customerId,
              customerDetail: g.customerDetail || g.customerName,
              plannedQty: parseDecimalVN(g.plannedQty),
            })),
          })),
        };
        const json = await apiPost(
          `/api/v1/orders/${encodeURIComponent(orderId)}/details`,
          body
        );
        if (!json.success) {
          throw new Error(json.error?.message || "Lỗi thêm xe mới");
        }
      }

      // 2) Xe cũ editable: PATCH detail + PUT plan
      const olds = blocks.filter((b) => !b.isNew);
      for (const b of olds) {
        const st = b.status;
        const canEdit =
          st.includes("Mới") ||
          st.includes("Đặt") ||
          st === "NEW" ||
          st === "ORDERED";
        if (!canEdit) continue;

        const resPatch = await fetch(
          `/api/v1/order-details/${encodeURIComponent(b.detailId)}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              year,
              vehicleId: b.vehicleId,
              productId: b.productId,
              regionId: b.regionId,
              note: b.note,
            }),
          }
        );
        const jp = await resPatch.json();
        if (!jp.success) {
          throw new Error(jp.error?.message || "Lỗi cập nhật chi tiết");
        }

        const resPlan = await fetch(
          `/api/v1/order-details/${encodeURIComponent(b.detailId)}/plan`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              year,
              deliveries: b.deliveries.map((g) => ({
                deliveryId: g.isNew ? undefined : g.idGh,
                customerId: g.customerId,
                customerDetail: g.customerDetail || g.customerName,
                plannedQty: parseDecimalVN(g.plannedQty),
              })),
            }),
          }
        );
        const jpl = await resPlan.json();
        if (!jpl.success) {
          throw new Error(jpl.error?.message || "Lỗi cập nhật kế hoạch giao");
        }
      }

      onSaved?.();
      await load();
      alert("Đã lưu thay đổi đơn " + orderId);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function removeBlock(idx: number) {
    const b = blocks[idx];
    if (!b) return;
    if (b.isNew) {
      setBlocks((rows) => rows.filter((_, i) => i !== idx));
      return;
    }
    // Xe đã lưu: chỉ xóa local nếu user xác nhận hủy qua API
    if (
      !confirm(
        `Xóa/hủy chi tiết ${b.detailId}?\n(Xe đã lưu sẽ gọi API hủy nếu đủ điều kiện)`
      )
    )
      return;
    void (async () => {
      setBusy(true);
      try {
        const json = await apiPost(
          `/api/v1/order-details/${encodeURIComponent(b.detailId)}/cancel`,
          { year }
        );
        if (!json.success) {
          throw new Error(json.error?.message || "Không hủy được");
        }
        setBlocks((rows) => rows.filter((_, i) => i !== idx));
      } catch (e: unknown) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }

  if (!orderId) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-bold text-slate-800 text-sm sm:text-base">
            Quản lý Đơn: {orderId}
          </h3>
          <button
            type="button"
            className="text-xl text-slate-400"
            onClick={() => !busy && onClose()}
          >
            ×
          </button>
        </div>

        {order && (
          <div className="px-4 py-2 border-b bg-slate-50 text-[12px] text-slate-700 flex flex-wrap gap-x-3 gap-y-1 items-center">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
              {order.status}
            </span>
            <span>
              <b>NCC:</b> {order.supplierName || order.supplierId}
            </span>
            <span>
              <b>Ngày:</b> {order.orderDate}
            </span>
            <span>
              <b>Tổng KH:</b> {totals.plan.toFixed(2)}
            </span>
            <span>
              <b>Thực nhận:</b> {totals.recv.toFixed(2)}
            </span>
            <span>
              <b>Thực giao:</b> {totals.del.toFixed(2)}
            </span>
          </div>
        )}

        <div className="p-3 overflow-y-auto flex-1 space-y-3">
          {loading && (
            <div className="text-center text-slate-500 py-8">Đang tải…</div>
          )}
          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          {!loading &&
            blocks.map((b, bi) => {
              const needCarrier = needsDvt(b.transportTypeId, b.canChonDvt);
              const xeDisabled =
                !b.transportTypeId || (needCarrier && !b.carrierId && b.isNew);
              const khSum = b.deliveries.reduce(
                (s, g) => s + parseDecimalVN(g.plannedQty),
                0
              );
              const lockedRecv = b.actualReceived > 0;

              return (
                <div
                  key={b.key}
                  className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/40 relative"
                >
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-500">
                      {b.isNew ? "Xe mới (chưa lưu)" : b.detailId} · {b.status}
                    </span>
                    <div className="flex gap-1">
                      {editable && (
                        <button
                          type="button"
                          disabled={blocks.length >= 6}
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-sky-50 text-sky-700 border border-sky-200 disabled:opacity-40"
                          onClick={() => {
                            setBlocks((rows) => {
                              if (rows.length >= 6) return rows;
                              const src = rows[bi];
                              if (!src) return rows;
                              const uid = () =>
                                `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                              const cloned: Block = {
                                key: `b-${uid()}`,
                                detailId: "",
                                isNew: true,
                                status: "Mới tạo",
                                transportTypeId: src.transportTypeId,
                                transportTypeName: src.transportTypeName,
                                canChonDvt: src.canChonDvt,
                                carrierId: src.carrierId,
                                carrierName: src.carrierName,
                                vehicleId: src.vehicleId,
                                vehicleName: src.vehicleName,
                                productId: src.productId,
                                productName: src.productName,
                                regionId: src.regionId,
                                regionName: src.regionName,
                                note: src.note,
                                actualReceived: 0,
                                deliveries: src.deliveries.map((g) => ({
                                  key: `gh-${uid()}`,
                                  idGh: "",
                                  isNew: true,
                                  customerId: g.customerId,
                                  customerName: g.customerName,
                                  customerDetail: g.customerDetail,
                                  plannedQty: g.plannedQty,
                                  actualQty: 0,
                                })),
                              };
                              const next = [...rows];
                              next.splice(bi + 1, 0, cloned);
                              return next;
                            });
                          }}
                        >
                          📋 Copy khối xe
                        </button>
                      )}
                      {editable && (
                        <button
                          type="button"
                          className="w-7 h-7 rounded-lg bg-red-50 text-red-600 border border-red-200 font-bold"
                          title={
                            b.isNew
                              ? "Xóa khối chưa lưu"
                              : "Hủy chi tiết đã lưu"
                          }
                          onClick={() => removeBlock(bi)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-0.5">
                        Hình thức VT
                      </div>
                      <MasterPicker
                        type="HTVT"
                        value={b.transportTypeId}
                        displayName={b.transportTypeName}
                        disabled={!editable || lockedRecv}
                        onChange={(id, name, raw) => {
                          const can =
                            String(raw?.CanChonDVT || "")
                              .toLowerCase()
                              .match(/^(true|1|yes|có|co)$/) != null ||
                            String(id).toUpperCase().includes("THUE");
                          setBlocks((rows) =>
                            rows.map((x, i) =>
                              i === bi
                                ? {
                                    ...x,
                                    transportTypeId: id,
                                    transportTypeName: name,
                                    canChonDvt: !!can,
                                    carrierId: "",
                                    carrierName: "",
                                    vehicleId: "",
                                    vehicleName: "",
                                  }
                                : x
                            )
                          );
                        }}
                      />
                    </div>
                    {needCarrier && (
                      <div>
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          Đơn vị vận tải
                        </div>
                        <MasterPicker
                          type="DVT"
                          value={b.carrierId}
                          displayName={b.carrierName}
                          disabled={!editable || lockedRecv}
                          onChange={(id, name) =>
                            setBlocks((rows) =>
                              rows.map((x, i) =>
                                i === bi
                                  ? {
                                      ...x,
                                      carrierId: id,
                                      carrierName: name,
                                      vehicleId: "",
                                      vehicleName: "",
                                    }
                                  : x
                              )
                            )
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-0.5">
                        Biển số xe
                      </div>
                      <MasterPicker
                        type="XE"
                        value={b.vehicleId}
                        displayName={b.vehicleName}
                        disabled={!editable || lockedRecv || xeDisabled}
                        htvtId={b.transportTypeId || undefined}
                        dvtId={
                          needCarrier ? b.carrierId || undefined : undefined
                        }
                        onChange={(id, name) =>
                          setBlocks((rows) =>
                            rows.map((x, i) =>
                              i === bi
                                ? { ...x, vehicleId: id, vehicleName: name }
                                : x
                            )
                          )
                        }
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-0.5">
                        Hàng hóa
                      </div>
                      <MasterPicker
                        type="HH"
                        value={b.productId}
                        displayName={b.productName}
                        supplierId={order?.supplierId}
                        disabled={!editable || lockedRecv}
                        onChange={(id, name) =>
                          setBlocks((rows) =>
                            rows.map((x, i) =>
                              i === bi
                                ? { ...x, productId: id, productName: name }
                                : x
                            )
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-0.5">
                        Khu vực/Công trình
                      </div>
                      <MasterPicker
                        type="KV"
                        value={b.regionId}
                        displayName={b.regionName}
                        disabled={!editable || lockedRecv}
                        onChange={(id, name) =>
                          setBlocks((rows) =>
                            rows.map((x, i) =>
                              i === bi
                                ? { ...x, regionId: id, regionName: name }
                                : x
                            )
                          )
                        }
                      />
                    </div>
                    <div className="text-right text-[11px] text-slate-600 pb-1">
                      Tổng KH: <b>{khSum.toFixed(2)}</b>
                      <br />
                      {b.isNew ? "Mới tạo" : b.status}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Ghi chú</div>
                    <input
                      value={b.note}
                      disabled={!editable || lockedRecv}
                      onChange={(e) =>
                        setBlocks((rows) =>
                          rows.map((x, i) =>
                            i === bi ? { ...x, note: e.target.value } : x
                          )
                        )
                      }
                      className="w-full px-3 py-2 rounded-lg border text-sm disabled:bg-slate-100"
                    />
                  </div>

                  {/* GH table */}
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-200 text-slate-700">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Khách hàng</th>
                          <th className="px-2 py-1.5 text-left">Chi tiết KH</th>
                          <th className="px-2 py-1.5 text-center w-24">Đặt hàng</th>
                          <th className="px-2 py-1.5 text-center w-20">Thực giao</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {b.deliveries.map((g, gi) => (
                          <tr key={g.key} className="border-t">
                            <td className="px-1 py-1 min-w-[140px]">
                              <MasterPicker
                                type="KH"
                                value={g.customerId}
                                displayName={g.customerName}
                                disabled={!editable || lockedRecv}
                                onChange={(id, name) =>
                                  setBlocks((rows) =>
                                    rows.map((x, i) =>
                                      i === bi
                                        ? {
                                            ...x,
                                            deliveries: x.deliveries.map(
                                              (dd, j) =>
                                                j === gi
                                                  ? {
                                                      ...dd,
                                                      customerId: id,
                                                      customerName: name,
                                                    }
                                                  : dd
                                            ),
                                          }
                                        : x
                                    )
                                  )
                                }
                              />
                            </td>
                            <td className="px-1 py-1">
                              <input
                                value={g.customerDetail}
                                disabled={!editable || lockedRecv}
                                onChange={(e) =>
                                  setBlocks((rows) =>
                                    rows.map((x, i) =>
                                      i === bi
                                        ? {
                                            ...x,
                                            deliveries: x.deliveries.map(
                                              (dd, j) =>
                                                j === gi
                                                  ? {
                                                      ...dd,
                                                      customerDetail:
                                                        e.target.value,
                                                    }
                                                  : dd
                                            ),
                                          }
                                        : x
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 border rounded text-sm disabled:bg-slate-100"
                                placeholder="Chi tiết khách"
                              />
                            </td>
                            <td className="px-1 py-1">
                              <DecimalInput
                                value={g.plannedQty}
                                disabled={!editable || lockedRecv}
                                onValueChange={(display) =>
                                  setBlocks((rows) =>
                                    rows.map((x, i) =>
                                      i === bi
                                        ? {
                                            ...x,
                                            deliveries: x.deliveries.map(
                                              (dd, j) =>
                                                j === gi
                                                  ? {
                                                      ...dd,
                                                      plannedQty: display,
                                                    }
                                                  : dd
                                            ),
                                          }
                                        : x
                                    )
                                  )
                                }
                              />
                            </td>
                            <td className="px-1 py-1 text-center text-slate-500">
                              {g.actualQty.toFixed(2)}
                            </td>
                            <td className="px-1 py-1">
                              {editable && !lockedRecv && (
                                <button
                                  type="button"
                                  disabled={b.deliveries.length <= 1}
                                  onClick={() =>
                                    setBlocks((rows) =>
                                      rows.map((x, i) =>
                                        i === bi
                                          ? {
                                              ...x,
                                              deliveries: x.deliveries.filter(
                                                (_, j) => j !== gi
                                              ),
                                            }
                                          : x
                                      )
                                    )
                                  }
                                  className="w-7 h-7 rounded bg-red-500 text-white font-bold disabled:opacity-30"
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {editable && !lockedRecv && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-sky-600"
                      onClick={() =>
                        setBlocks((rows) =>
                          rows.map((x, i) =>
                            i === bi
                              ? {
                                  ...x,
                                  deliveries: [...x.deliveries, emptyGh()],
                                }
                              : x
                          )
                        )
                      }
                    >
                      + Thêm khách
                    </button>
                  )}
                </div>
              );
            })}
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap gap-2 justify-end">
          {editable && blocks.length < 6 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setBlocks((rows) => [...rows, emptyBlock()])}
              className="px-3 py-2 text-sm font-semibold rounded-xl border border-slate-300 bg-white hover:bg-slate-50"
            >
              + Thêm xe
            </button>
          )}
          {editable && (
            <button
              type="button"
              disabled={busy || loading}
              onClick={saveAll}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? "Đang lưu…" : "💾 LƯU THAY ĐỔI"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-3 py-2 text-sm font-semibold rounded-xl bg-slate-200 text-slate-700"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
