"use client";

/**
 * Tab Tài chính NCC — gom 4 phân hệ (parity V21):
 * 1. Tổng hợp công nợ
 * 2. Sổ phát sinh
 * 3. Dư đầu năm & Chốt năm
 * 4. Giá mua
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PayablesSummary } from "@/components/finance/PayablesSummary";
import { PhatSinhPanel } from "@/components/finance/PhatSinhPanel";
import { DuDauNamPanel } from "@/components/finance/DuDauNamPanel";
import { PricesPanel } from "@/components/finance/PricesPanel";
import { clientHasAny, readClientUser } from "@/lib/nav-access";

type FinTab = "tonghop" | "phatsinh" | "dudaunam" | "giamua";

const TABS: Array<{
  id: FinTab;
  label: string;
  need?: string[];
}> = [
  { id: "tonghop", label: "Tổng hợp công nợ", need: ["PAYABLE_VIEW", "*"] },
  { id: "phatsinh", label: "Sổ phát sinh", need: ["PAYABLE_VIEW", "*"] },
  { id: "dudaunam", label: "Dư đầu năm", need: ["PAYABLE_VIEW", "*"] },
  {
    id: "giamua",
    label: "Giá mua",
    need: ["PURCHASE_PRICE_VIEW", "PAYABLE_VIEW", "*"],
  },
];

function FinanceBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const user = readClientUser();
  const tabParam = (sp.get("tab") || "tonghop") as FinTab;
  const [tab, setTab] = useState<FinTab>(
    TABS.some((t) => t.id === tabParam) ? tabParam : "tonghop"
  );

  useEffect(() => {
    const t = (sp.get("tab") || "tonghop") as FinTab;
    if (TABS.some((x) => x.id === t)) setTab(t);
  }, [sp]);

  function switchTab(id: FinTab) {
    setTab(id);
    router.replace(`/payables?tab=${id}`, { scroll: false });
  }

  const visibleTabs = TABS.filter(
    (t) => !t.need || clientHasAny(user, t.need)
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">Tài chính NCC</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Công nợ · Phát sinh · Dư đầu năm · Giá mua
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-0">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTab(t.id)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition ${
              tab === t.id
                ? "border-blue-600 text-blue-700 bg-blue-50/80"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[320px]">
        {tab === "tonghop" && <PayablesSummary />}
        {tab === "phatsinh" && <PhatSinhPanel />}
        {tab === "dudaunam" && <DuDauNamPanel />}
        {tab === "giamua" && <PricesPanel />}
      </div>
    </div>
  );
}

export default function FinancePage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-slate-500">Đang tải Tài chính…</div>
      }
    >
      <FinanceBody />
    </Suspense>
  );
}
