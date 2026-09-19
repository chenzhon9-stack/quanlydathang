"use client";

import { ReportSubNav } from "@/components/ReportSubNav";

export default function ReportPage() {
  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Báo cáo</h2>
          <p className="text-xs text-slate-500">Đối chiếu N-G</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => alert("[Mock] Xuất CSV — exportDynamicReportCsv()")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white"
          >
            Xuất CSV
          </button>
          <button
            onClick={() => alert("[Mock] Tùy chỉnh cột")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tùy chỉnh cột
          </button>
          <button
            onClick={() => alert("[Mock] CHẤP NHẬN — loadReportByType()")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white"
          >
            Chấp nhận
          </button>
        </div>
      </div>

      <ReportSubNav />

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500">Từ ngày</label>
            <input type="date" className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Đến ngày</label>
            <input type="date" className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Group By</label>
            <select className="w-full mt-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
              <option>Không nhóm</option>
              <option>NCC</option>
              <option>Hàng hóa</option>
              <option>Khách hàng</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto border border-slate-100 rounded-lg">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                <th className="px-3 py-2.5 text-left font-semibold">Cột 1</th>
                <th className="px-3 py-2.5 text-left font-semibold">Cột 2</th>
                <th className="px-3 py-2.5 text-right font-semibold">Số lượng</th>
                <th className="px-3 py-2.5 text-right font-semibold">Giá trị</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-slate-400 text-sm">
                  Báo cáo <strong>Đối chiếu N-G</strong> — chờ API ReportService (Phase A+).
                  <br />
                  <span className="text-xs">Bấm &quot;Chấp nhận&quot; để load (mock).</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
