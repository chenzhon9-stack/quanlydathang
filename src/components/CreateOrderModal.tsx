"use client";

import React, { useMemo, useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { DecimalInput, parseDecimalVN, formatDecimalVN } from "@/components/DecimalInput";
import { apiPost } from "@/components/ActionPrompt";

/** datetime-local value from Date (local) */
function toDatetimeLocalValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO-ish local string for API: yyyy-MM-ddTHH:mm:ss */
function toApiDateTime(local: string): string {
  if (!local) return "";
  // datetime-local → append :00 if no seconds
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return local + ":00";
  return local;
}

type DeliveryRow = {
  key: string;
  customerId: string;
  customerName: string;
  plannedQty: string;
};

type DetailRow = {
  key: string;
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
  deliveries: DeliveryRow[];
};

function emptyDelivery(): DeliveryRow {
  return {
    key: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    customerId: "",
    customerName: "",
    plannedQty: "",
  };
}

function emptyDetail(): DetailRow {
  return {
    key: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    deliveries: [emptyDelivery()],
  };
}

function needsDvt(maHtvt: string, canChon: boolean): boolean {
  const c = String(maHtvt || "").toUpperCase();
  return canChon || c === "THUE_NGOAI" || c.includes("THUE");
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (orderId: string) => void;
};

export function CreateOrderModal({ open, onClose, onCreated }: Props) {
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [orderDateTime, setOrderDateTime] = useState(toDatetimeLocalValue());
  const [details, setDetails] = useState<DetailRow[]>([emptyDetail()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    setErr(null);
    if (!supplierId) {
      setErr("Chọn nhà cung cấp");
      return;
    }
    if (!details.length) {
      setErr("Thêm ít nhất 1 xe");
      return;
    }
    if (details.length > 6) {
      setErr("Tối đa 6 xe / đơn");
      return;
    }
    // Không trùng (xe + hàng) trong cùng đơn — V21
    const pairSeen = new Set<string>();
    for (const d of details) {
      const pair = `${String(d.vehicleId).trim()}|${String(d.productId).trim()}`;
      if (d.vehicleId && d.productId) {
        if (pairSeen.has(pair)) {
          setErr(
            `Trùng biển số xe + hàng hóa trong đơn: ${d.vehicleName || d.vehicleId} / ${d.productName || d.productId}`
          );
          return;
        }
        pairSeen.add(pair);
      }
    }

    for (const d of details) {
      if (!d.transportTypeId) {
        setErr("Chọn hình thức vận tải trước khi chọn xe");
        return;
      }
      if (needsDvt(d.transportTypeId, d.canChonDvt) && !d.carrierId) {
        setErr("Hình thức thuê ngoài — bắt buộc chọn đơn vị vận tải");
        return;
      }
      if (!d.vehicleId || !d.productId || !d.regionId) {
        setErr("Thiếu xe / hàng hóa / khu vực");
        return;
      }
      for (const g of d.deliveries) {
        if (!g.customerId || parseDecimalVN(g.plannedQty) <= 0) {
          setErr("Mỗi dòng KH giao cần khách hàng và SL > 0");
          return;
        }
      }
    }

    setBusy(true);
    try {
      const body = {
        supplierId,
        orderDate: toApiDateTime(orderDateTime),
        year: Number(orderDateTime.slice(0, 4)),
        details: details.map((d) => ({
          vehicleId: d.vehicleId,
          productId: d.productId,
          regionId: d.regionId,
          note: d.note,
          transportTypeId: d.transportTypeId || undefined,
          transportTypeName: d.transportTypeName || undefined,
          carrierId: d.carrierId || undefined,
          deliveries: d.deliveries.map((g) => ({
            customerId: g.customerId,
            customerDetail: g.customerDetail || "",
            plannedQty: parseDecimalVN(g.plannedQty),
          })),
        })),
      };
      const json = await apiPost("/api/v1/orders", body);
      if (!json.success) {
        throw new Error(json.error?.message || "Lỗi tạo đơn");
      }
      const orderId = (json.data as { orderId?: string })?.orderId || "";
      onCreated?.(orderId);
      onClose();
      setSupplierId("");
      setSupplierName("");
      setDetails([emptyDetail()]);
      setOrderDateTime(toDatetimeLocalValue());
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-bold text-slate-800">+ Tạo đơn hàng mới</h3>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="text-xl text-slate-400"
          >
            ×
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">
              Ngày đặt hàng
            </div>
            <input
              type="datetime-local"
              step="1"
              value={orderDateTime}
              onChange={(e) => setOrderDateTime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
            />
          </div>

          <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">
              Nhà cung cấp *
            </div>
            <MasterPicker
              type="NCC"
              value={supplierId}
              displayName={supplierName}
              disabled={details.some((d) => !!d.productId)}
              placeholder={
                details.some((d) => !!d.productId)
                  ? "Đã chọn hàng — không đổi NCC"
                  : "Bấm chọn NCC…"
              }
              onChange={(id, name) => {
                // Chỉ cho đổi khi chưa gắn hàng hóa nào
                if (details.some((d) => !!d.productId)) return;
                setSupplierId(id);
                setSupplierName(name);
                // đổi NCC → clear HH đã chọn (phòng hờ)
                setDetails((rows) =>
                  rows.map((x) => ({
                    ...x,
                    productId: "",
                    productName: "",
                  }))
                );
              }}
            />
            {details.some((d) => !!d.productId) && (
              <p className="text-[11px] text-amber-700 mt-1">
                Đã chọn hàng hóa — không thể đổi nhà cung cấp (hàng thuộc NCC).
              </p>
            )}
          </div>

          {details.map((d, di) => {
            const needCarrier = needsDvt(d.transportTypeId, d.canChonDvt);
            const xeDisabled = !d.transportTypeId || (needCarrier && !d.carrierId);
            return (
              <div
                key={d.key}
                className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-bold text-slate-700">
                    Chọn — Hình thức VT; Xe &amp; Hàng; Khách hàng #{di + 1}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      title="Tạo khối xe mới copy đầy đủ từ khối này (V21 copyOrderBlock)"
                      disabled={details.length >= 6}
                      className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 disabled:opacity-40 disabled:pointer-events-none"
                      onClick={() => {
                        setDetails((rows) => {
                          if (rows.length >= 6) return rows;
                          const src = rows[di];
                          if (!src) return rows;
                          const uid = () =>
                            `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                          const cloned: DetailRow = {
                            key: `ct-${uid()}`,
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
                            deliveries: (src.deliveries.length
                              ? src.deliveries
                              : [
                                  {
                                    key: "",
                                    customerId: "",
                                    customerName: "",
                                    plannedQty: "",
                                  },
                                ]
                            ).map((g) => ({
                              key: `d-${uid()}`,
                              customerId: g.customerId,
                              customerName: g.customerName,
                              plannedQty: g.plannedQty,
                            })),
                          };
                          // Chèn ngay sau khối nguồn (V21 addDetailBlock)
                          const next = [...rows];
                          next.splice(di + 1, 0, cloned);
                          return next;
                        });
                      }}
                    >
                      📋 Copy khối xe
                    </button>
                    {details.length > 1 && (
                      <button
                        type="button"
                        className="w-7 h-7 rounded-lg bg-red-50 text-red-600 border border-red-200 font-bold"
                        onClick={() =>
                          setDetails((rows) => rows.filter((_, i) => i !== di))
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* HTVT */}
                <div>
                  <div className="text-[10px] text-slate-500 mb-0.5">
                    Hình thức VT *
                  </div>
                  <MasterPicker
                    type="HTVT"
                    value={d.transportTypeId}
                    displayName={d.transportTypeName}
                    onChange={(id, name, raw) => {
                      const can =
                        String(raw?.CanChonDVT || raw?.CanChonDvt || "")
                          .toLowerCase()
                          .match(/^(true|1|yes|có|co)$/) != null ||
                        String(id).toUpperCase().includes("THUE");
                      setDetails((rows) =>
                        rows.map((x, i) =>
                          i === di
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

                {/* DVT nếu thuê ngoài */}
                {needCarrier && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">
                      Đơn vị vận tải *
                    </div>
                    <MasterPicker
                      type="DVT"
                      value={d.carrierId}
                      displayName={d.carrierName}
                      onChange={(id, name) =>
                        setDetails((rows) =>
                          rows.map((x, i) =>
                            i === di
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">
                      Biển số xe *
                    </div>
                    <MasterPicker
                      type="XE"
                      value={d.vehicleId}
                      displayName={d.vehicleName}
                      disabled={xeDisabled}
                      htvtId={d.transportTypeId || undefined}
                      dvtId={needCarrier ? d.carrierId || undefined : undefined}
                      placeholder={
                        xeDisabled
                          ? needCarrier
                            ? "Chọn HTVT và ĐVT trước…"
                            : "Chọn hình thức VT trước…"
                          : "Chọn xe…"
                      }
                      onChange={(id, name) =>
                        setDetails((rows) =>
                          rows.map((x, i) =>
                            i === di
                              ? { ...x, vehicleId: id, vehicleName: name }
                              : x
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">
                      Hàng hóa *
                    </div>
                    <MasterPicker
                      type="HH"
                      value={d.productId}
                      displayName={d.productName}
                      supplierId={supplierId}
                      placeholder={
                        supplierId ? "Chọn hàng theo NCC…" : "Chọn NCC trước…"
                      }
                      disabled={!supplierId}
                      onChange={(id, name) =>
                        setDetails((rows) =>
                          rows.map((x, i) =>
                            i === di
                              ? { ...x, productId: id, productName: name }
                              : x
                          )
                        )
                      }
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 mb-0.5">
                    Khu vực/Công trình *
                  </div>
                  <MasterPicker
                    type="KV"
                    value={d.regionId}
                    displayName={d.regionName}
                    onChange={(id, name) =>
                      setDetails((rows) =>
                        rows.map((x, i) =>
                          i === di
                            ? { ...x, regionId: id, regionName: name }
                            : x
                        )
                      )
                    }
                  />
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 mb-0.5">Ghi chú</div>
                  <input
                    value={d.note}
                    onChange={(e) =>
                      setDetails((rows) =>
                        rows.map((x, i) =>
                          i === di ? { ...x, note: e.target.value } : x
                        )
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                  />
                </div>

                <div className="text-[10px] font-semibold text-slate-500 uppercase">
                  Kế hoạch giao
                </div>
                {d.deliveries.map((g, gi) => (
                  <div
                    key={g.key}
                    className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2 items-start"
                  >
                    <MasterPicker
                      type="KH"
                      value={g.customerId}
                      displayName={g.customerName}
                      onChange={(id, name) =>
                        setDetails((rows) =>
                          rows.map((x, i) =>
                            i === di
                              ? {
                                  ...x,
                                  deliveries: x.deliveries.map((dd, j) =>
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
                    <DecimalInput
                      value={g.plannedQty}
                      placeholder="KH giao"
                      onValueChange={(display) =>
                        setDetails((rows) =>
                          rows.map((x, i) =>
                            i === di
                              ? {
                                  ...x,
                                  deliveries: x.deliveries.map((dd, j) =>
                                    j === gi
                                      ? { ...dd, plannedQty: display }
                                      : dd
                                  ),
                                }
                              : x
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      title="Xóa dòng KH"
                      disabled={d.deliveries.length <= 1}
                      onClick={() =>
                        setDetails((rows) =>
                          rows.map((x, i) =>
                            i === di
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
                      className="w-8 h-8 rounded-lg bg-red-500 text-white font-bold disabled:opacity-30"
                    >
                      −
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs font-semibold text-sky-600"
                  onClick={() =>
                    setDetails((rows) =>
                      rows.map((x, i) =>
                        i === di
                          ? {
                              ...x,
                              deliveries: [...x.deliveries, emptyDelivery()],
                            }
                          : x
                      )
                    )
                  }
                >
                  + Thêm khách kế hoạch
                </button>
              </div>
            );
          })}

          {details.length < 6 && (
            <button
              type="button"
              onClick={() => setDetails((rows) => [...rows, emptyDetail()])}
              className="text-sm font-semibold text-sky-600"
            >
              + Thêm xe/Hàng hóa
            </button>
          )}
        </div>

        <div className="px-4 py-3 border-t">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm disabled:opacity-50"
          >
            {busy ? "Đang tạo…" : "LƯU TẤT CẢ"}
          </button>
        </div>
      </div>
    </div>
  );
}
