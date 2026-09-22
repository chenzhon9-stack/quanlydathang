/** Types so sánh sản lượng dashboard */
export type VolumeMode = "ytd" | "mom";
export type VolumeMetric = "receiving" | "delivery";
export type VolumeGroupBy = "phanloai" | "supplier";

export interface VolumeSeriesItem {
  /** Bao | Roi | Khac hoặc MaNCC / TenNCC */
  label: string;
  id?: string;
  current: number;
  previous: number;
  /** Tổng cả năm trước (chỉ khi mode=ytd, ghi chú riêng) */
  previousFullYear?: number;
}

export interface VolumeCompareResult {
  mode: VolumeMode;
  metric: VolumeMetric;
  groupBy: VolumeGroupBy;
  year: number;
  series: VolumeSeriesItem[];
  meta: {
    currentFrom: string;
    currentTo: string;
    previousFrom: string;
    previousTo: string;
    /** Giải thích khoảng thời gian */
    periodNote: string;
  };
}
