/** Mock sản lượng YTD / MOM theo PhanLoaiHH — thay bằng API khi có Sheet */
export type VolumeMode = "ytd" | "mom";
export type VolumeMetric = "receiving" | "delivery";

export interface VolumeSeriesItem {
  label: "Bao" | "Roi" | "Khac";
  current: number;
  previous: number;
}

export interface VolumeCompareResult {
  mode: VolumeMode;
  metric: VolumeMetric;
  year: number;
  series: VolumeSeriesItem[];
  meta: {
    currentFrom: string;
    currentTo: string;
    previousFrom: string;
    previousTo: string;
  };
}

const YTD_RECEIVING: VolumeSeriesItem[] = [
  { label: "Bao", current: 28540.5, previous: 25120.0 },
  { label: "Roi", current: 18230.25, previous: 19450.8 },
  { label: "Khac", current: 3120.0, previous: 2890.5 },
];

const YTD_DELIVERY: VolumeSeriesItem[] = [
  { label: "Bao", current: 27800.0, previous: 24500.0 },
  { label: "Roi", current: 17650.0, previous: 18800.0 },
  { label: "Khac", current: 2980.0, previous: 2750.0 },
];

const MOM_RECEIVING: VolumeSeriesItem[] = [
  { label: "Bao", current: 4200.5, previous: 3980.0 },
  { label: "Roi", current: 2150.0, previous: 2400.25 },
  { label: "Khac", current: 380.0, previous: 350.0 },
];

const MOM_DELIVERY: VolumeSeriesItem[] = [
  { label: "Bao", current: 4100.0, previous: 3900.0 },
  { label: "Roi", current: 2050.0, previous: 2300.0 },
  { label: "Khac", current: 360.0, previous: 340.0 },
];

export function getMockVolumeCompare(
  mode: VolumeMode,
  metric: VolumeMetric,
  year = 2026
): VolumeCompareResult {
  const series =
    mode === "ytd"
      ? metric === "receiving"
        ? YTD_RECEIVING
        : YTD_DELIVERY
      : metric === "receiving"
        ? MOM_RECEIVING
        : MOM_DELIVERY;

  if (mode === "ytd") {
    return {
      mode,
      metric,
      year,
      series,
      meta: {
        currentFrom: `${year}-01-01`,
        currentTo: `${year}-09-18`,
        previousFrom: `${year - 1}-01-01`,
        previousTo: `${year - 1}-09-18`,
      },
    };
  }

  // MOM: tháng 9 vs tháng 8
  return {
    mode,
    metric,
    year,
    series,
    meta: {
      currentFrom: `${year}-09-01`,
      currentTo: `${year}-09-18`,
      previousFrom: `${year}-08-01`,
      previousTo: `${year}-08-31`,
    },
  };
}
