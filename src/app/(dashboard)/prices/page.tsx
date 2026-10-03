"use client";

/**
 * Deep-link /prices → tab Giá mua trong Tài chính NCC
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PricesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/payables?tab=giamua");
  }, [router]);
  return (
    <div className="text-sm text-slate-500 p-6">
      Đang chuyển tới Tài chính → Giá mua…
    </div>
  );
}
