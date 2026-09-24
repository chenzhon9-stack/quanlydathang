"use client";

import React, { useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { apiPost } from "@/components/ActionPrompt";
import { todayYmdVN } from "@/lib/sheets/date";

type DeliveryRow = {
  key: string;
  customerId: string;
  customerName: string;
  plannedQty: string;
};

type DetailRow = {
  key: string;
  vehicleId: string;
  vehicleName: string;
  productId: string;
  productName: string;
  regionId: string;
  regionName: string;
  note: string;
  transportTypeId: string;
  transportTypeName: string;
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
    vehicleId: "",
    vehicleName: "",
    productId: "",
    productName: "",
    regionId: "",
    regionName: "",
    note: "",
    transportTypeId: "",
    transportTypeName: "",
    deliveries: [emptyDelivery()],
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (orderId: string) => void;
};

export function CreateOrderModal({ open, onClose, onCreated }: Props) {
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [orderDate, setOrderDate] = useState(todayYmdVN());
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

    setBusy(true);
    try {
      const body = {
        supplierId,
        orderDate,
        year: Number(orderDate.slice(0, 4)),
        details: details.map((d) => ({
          vehicleId: d.vehicleId,
          productId: d.productId,
          regionId: d.regionId,
          note: d.note,
          transportTypeId: d.transportTypeId || undefined,
          transportTypeName: d.transportTypeName || undefined,
          deliveries: d.deliveries.map((g) => ({
            customerId: g.customerId,
            customerDetail: g.customerName,
            plannedQty: Number(g.plannedQty) || 0,
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
      // reset
      setSupplierId("");
      setSupplierName("");
      setDetails([emptyDetail()]);
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
          <h3 className="font-bold text-slate-800">Tạo đơn hàng mới</h3>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">
                Nhà cung cấp *
              </div>
              <MasterPicker
                type="NCC"
                value={supplierId}
                displayName={supplierName}
                onChange={(id, name) => {
                  setSupplierId(id);
                  setSupplierName(name);
                }}
              />
            </div>
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">
                Ngày đặt *
              </div>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border text-sm"
              />
            </div>
          </div>

          {details.map((d, di) => (
            <div
              key={d.key}
              className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-600">
                  Xe #{di + 1}
                </div>
                {details.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-600 font-semibold"
                    onClick={() =>
                      setDetails((rows) => rows.filter((_, i) => i !== di))
                    }
                  >
                    Xóa xe
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 mb-0.5">Xe *</div>
                  <MasterPicker
                    type="XE"
                    value={d.vehicleId}
                    displayName={d.vehicleName}
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
                <div>
                  <div className="text-[10px] text-slate-500 mb-0.5">
                    Khu vực *
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
                  <input
                    type="number"
                    step="0.01"
                    placeholder="SL (tấn)"
                    value={g.plannedQty}
                    onChange={(e) =>
                      setDetails((rows) =>
                        rows.map((x, i) =>
                          i === di
                            ? {
                                ...x,
                                deliveries: x.deliveries.map((dd, j) =>
                                  j === gi
                                    ? { ...dd, plannedQty: e.target.value }
                                    : dd
                                ),
                              }
                            : x
                        )
                      )
                    }
                    className="w-full px-2 py-2 text-sm border rounded-lg tabular-nums text-center"
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
          ))}

          {details.length < 6 && (
            <button
              type="button"
              onClick={() => setDetails((rows) => [...rows, emptyDetail()])}
              className="text-sm font-semibold text-sky-600"
            >
              + Thêm xe (tối đa 6)
            </button>
          )}
        </div>

        <div className="px-4 py-3 border-t">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm disabled:opacity-50"
          >
            {busy ? "Đang tạo…" : "TẠO ĐƠN"}
          </button>
        </div>
      </div>
    </div>
  );
}
