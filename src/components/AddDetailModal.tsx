"use client";

import React, { useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { apiPost } from "@/components/ActionPrompt";
import type { Order } from "@/types";

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
    deliveries: [emptyDelivery()],
  };
}

type Props = {
  order: Order | null;
  onClose: () => void;
  onAdded?: () => void;
};

export function AddDetailModal({ order, onClose, onAdded }: Props) {
  const [details, setDetails] = useState<DetailRow[]>([emptyDetail()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!order) return null;

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const body = {
        year: new Date().getFullYear(),
        details: details.map((d) => ({
          vehicleId: d.vehicleId,
          productId: d.productId,
          regionId: d.regionId,
          note: d.note,
          deliveries: d.deliveries.map((g) => ({
            customerId: g.customerId,
            customerDetail: g.customerName,
            plannedQty: Number(g.plannedQty) || 0,
          })),
        })),
      };
      const json = await apiPost(
        `/api/v1/orders/${encodeURIComponent(order.orderId)}/details`,
        body
      );
      if (!json.success) {
        throw new Error(json.error?.message || "Lỗi thêm xe");
      }
      onAdded?.();
      onClose();
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-bold text-slate-800 text-sm sm:text-base">
            Thêm xe — {order.orderId} · {order.supplierName || order.supplierId}
          </h3>
          <button type="button" className="text-xl text-slate-400" onClick={() => !busy && onClose()}>
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          {details.map((d, di) => (
            <div key={d.key} className="border rounded-xl p-3 space-y-2 bg-slate-50/50">
              <div className="flex justify-between text-xs font-bold text-slate-600">
                <span>Xe mới #{di + 1}</span>
                {details.length > 1 && (
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => setDetails((rows) => rows.filter((_, i) => i !== di))}
                  >
                    Xóa
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <MasterPicker
                  type="XE"
                  value={d.vehicleId}
                  displayName={d.vehicleName}
                  onChange={(id, name) =>
                    setDetails((rows) =>
                      rows.map((x, i) =>
                        i === di ? { ...x, vehicleId: id, vehicleName: name } : x
                      )
                    )
                  }
                />
                <MasterPicker
                  type="HH"
                  value={d.productId}
                  displayName={d.productName}
                  supplierId={order.supplierId}
                  onChange={(id, name) =>
                    setDetails((rows) =>
                      rows.map((x, i) =>
                        i === di ? { ...x, productId: id, productName: name } : x
                      )
                    )
                  }
                />
                <MasterPicker
                  type="KV"
                  value={d.regionId}
                  displayName={d.regionName}
                  onChange={(id, name) =>
                    setDetails((rows) =>
                      rows.map((x, i) =>
                        i === di ? { ...x, regionId: id, regionName: name } : x
                      )
                    )
                  }
                />
              </div>
              {d.deliveries.map((g, gi) => (
                <div
                  key={g.key}
                  className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2"
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
                                    ? { ...dd, customerId: id, customerName: name }
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
                    placeholder="SL tấn"
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
                    className="px-2 py-2 text-sm border rounded-lg text-center"
                  />
                  <button
                    type="button"
                    disabled={d.deliveries.length <= 1}
                    onClick={() =>
                      setDetails((rows) =>
                        rows.map((x, i) =>
                          i === di
                            ? {
                                ...x,
                                deliveries: x.deliveries.filter((_, j) => j !== gi),
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
                        ? { ...x, deliveries: [...x.deliveries, emptyDelivery()] }
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
              className="text-sm font-semibold text-sky-600"
              onClick={() => setDetails((rows) => [...rows, emptyDetail()])}
            >
              + Thêm xe nữa
            </button>
          )}
        </div>
        <div className="px-4 py-3 border-t">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full py-3 rounded-xl bg-sky-500 text-white font-bold text-sm disabled:opacity-50"
          >
            {busy ? "Đang lưu…" : "LƯU THÊM XE"}
          </button>
        </div>
      </div>
    </div>
  );
}
