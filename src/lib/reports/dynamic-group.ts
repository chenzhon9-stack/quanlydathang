/** Parity V21 `_dynamicGroupBy_` / `_applyDynamicSort_` */

export type Measure = { field: string; agg: "SUM" | "COUNT" };

export function dynamicGroupBy(
  rows: Record<string, unknown>[],
  groupKeys: string[],
  measures: Measure[]
): Record<string, unknown>[] {
  if (!rows.length) return [];
  if (!groupKeys.length) {
    // no group → one total row
    const g: Record<string, unknown> = {};
    measures.forEach((m) => {
      g[m.field] = 0;
    });
    rows.forEach((row) => {
      measures.forEach((m) => {
        const val = Number(row[m.field]) || 0;
        if (m.agg === "SUM") g[m.field] = (g[m.field] as number) + val;
        else g[m.field] = (g[m.field] as number) + 1;
      });
    });
    return [g];
  }

  const groups: Record<string, Record<string, unknown>> = {};
  rows.forEach((row) => {
    const keys = groupKeys.map((k) => String(row[k] ?? ""));
    const composite = keys.join(" ||| ");
    if (!groups[composite]) {
      const g: Record<string, unknown> = {};
      groupKeys.forEach((k) => {
        g[k] = row[k] ?? "";
      });
      measures.forEach((m) => {
        g[m.field] = 0;
      });
      groups[composite] = g;
    }
    const item = groups[composite];
    measures.forEach((m) => {
      const val = Number(row[m.field]) || 0;
      if (m.agg === "SUM") item[m.field] = (item[m.field] as number) + val;
      else item[m.field] = (item[m.field] as number) + 1;
    });
  });
  return Object.values(groups);
}

export function applyDynamicSort(
  rows: Record<string, unknown>[],
  sortBy?: string,
  sortOrder: "asc" | "desc" = "desc"
): Record<string, unknown>[] {
  if (!sortBy || !rows.length) return rows;
  return rows.slice().sort((a, b) => {
    const va = a[sortBy];
    const vb = b[sortBy];
    const na = typeof va === "number";
    const nb = typeof vb === "number";
    if (na && nb) {
      return sortOrder === "desc"
        ? (vb as number) - (va as number)
        : (va as number) - (vb as number);
    }
    const sa = String(va ?? "").toLowerCase();
    const sb = String(vb ?? "").toLowerCase();
    if (sa === sb) return 0;
    const cmp = sa < sb ? -1 : 1;
    return sortOrder === "desc" ? -cmp : cmp;
  });
}

/** Schema cột báo cáo V21 */
export const REPORT_SCHEMAS = {
  thuc_nhan: {
    dimensions: [
      { key: "ncc", header: "Nhà cung cấp" },
      { key: "hangHoa", header: "Hàng hóa" },
      { key: "phanLoai", header: "Phân loại" },
      { key: "htvt", header: "Hình thức VT" },
      { key: "dvt", header: "ĐVVT" },
      { key: "xe", header: "Xe" },
      { key: "ngayNhan", header: "Ngày nhận" },
    ],
    measures: [
      { key: "thucNhan", header: "Thực nhận (tấn)", format: "num" },
      { key: "soChuyenNhan", header: "Số chuyến", format: "int" },
    ],
    defaultGroupBy: ["ncc", "hangHoa"],
    defaultSort: "thucNhan",
  },
  thuc_giao: {
    dimensions: [
      { key: "khachHang", header: "Khách hàng" },
      { key: "hangHoa", header: "Hàng hóa" },
      { key: "phanLoai", header: "Phân loại" },
      { key: "htvt", header: "Hình thức VT" },
      { key: "dvt", header: "ĐVVT" },
      { key: "xe", header: "Xe" },
      { key: "ngayGiao", header: "Ngày giao" },
    ],
    measures: [
      { key: "thucGiao", header: "Thực giao (tấn)", format: "num" },
      { key: "soChuyenGiao", header: "Số chuyến", format: "int" },
    ],
    defaultGroupBy: ["khachHang", "hangHoa"],
    defaultSort: "thucGiao",
  },
  giao_nhan: {
    dimensions: [
      { key: "xe", header: "Xe" },
      { key: "khachHang", header: "Khách hàng" },
      { key: "hangHoa", header: "Hàng hóa" },
    ],
    measures: [
      { key: "khGiao", header: "KH giao (tấn)", format: "num" },
      { key: "thucGiao", header: "Thực giao (tấn)", format: "num" },
      { key: "chenhLech", header: "Chênh lệch (tấn)", format: "num" },
    ],
    defaultGroupBy: ["xe", "khachHang", "hangHoa"],
    defaultSort: "thucGiao",
  },
  doi_chieu: {
    dimensions: [
      { key: "ncc", header: "Nhà cung cấp" },
      { key: "hangHoa", header: "Hàng hóa" },
      { key: "xe", header: "Xe" },
    ],
    measures: [
      { key: "thucNhan", header: "Nhận (tấn)", format: "num" },
      { key: "thucGiao", header: "Giao (tấn)", format: "num" },
      { key: "ton", header: "Tồn (tấn)", format: "num" },
    ],
    defaultGroupBy: ["ncc", "hangHoa"],
    defaultSort: "thucNhan",
  },
  van_tai: {
    dimensions: [
      { key: "dvt", header: "ĐVVT" },
      { key: "xe", header: "Xe" },
      { key: "khachHang", header: "Khách hàng" },
      { key: "hangHoa", header: "Hàng hóa" },
      { key: "ngayGiao", header: "Ngày giao" },
    ],
    measures: [
      { key: "thucGiao", header: "Thực giao (tấn)", format: "num" },
      { key: "thucNhan", header: "Thực nhận (tấn)", format: "num" },
      { key: "soChuyenVT", header: "Số chuyến", format: "int" },
    ],
    defaultGroupBy: ["dvt", "xe"],
    defaultSort: "thucNhan",
  },
} as const;

export type ReportType = keyof typeof REPORT_SCHEMAS;
