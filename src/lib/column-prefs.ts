/**
 * Lưu cấu hình cột theo tab (parity V21 reportColumnConfigV2).
 * localStorage key: quanlydathang.columnConfig.v1
 */
export type ColumnDef = {
  key: string;
  label: string;
  defaultVisible?: boolean;
  /** Cột có thể lọc giá trị trên header (V21 filter icon) */
  filterable?: boolean;
  /** Dimension — báo cáo groupBy / filterType */
  dimension?: boolean;
  /** align for th */
  align?: "left" | "right";
};

export type ColumnState = {
  visible: Record<string, boolean>;
  order: string[];
};

const STORAGE_KEY = "quanlydathang.columnConfig.v1";

function readAll(): Record<string, ColumnState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ColumnState>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function defaultState(cols: ColumnDef[]): ColumnState {
  const visible: Record<string, boolean> = {};
  const order: string[] = [];
  for (const c of cols) {
    order.push(c.key);
    visible[c.key] = c.defaultVisible !== false;
  }
  return { visible, order };
}

export function loadColumnState(
  tabKey: string,
  cols: ColumnDef[]
): ColumnState {
  const base = defaultState(cols);
  if (typeof window === "undefined") return base;
  const all = readAll();
  const saved = all[tabKey];
  if (!saved) return base;
  const visible = { ...base.visible, ...(saved.visible || {}) };
  // order: saved keys first (that still exist), then new cols
  const known = new Set(cols.map((c) => c.key));
  const order: string[] = [];
  for (const k of saved.order || []) {
    if (known.has(k) && !order.includes(k)) order.push(k);
  }
  for (const c of cols) {
    if (!order.includes(c.key)) order.push(c.key);
  }
  return { visible, order };
}

export function saveColumnState(tabKey: string, state: ColumnState) {
  if (typeof window === "undefined") return;
  const all = readAll();
  all[tabKey] = state;
  writeAll(all);
}

export function resolveColumns(
  cols: ColumnDef[],
  state: ColumnState
): ColumnDef[] {
  const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  const ordered: ColumnDef[] = [];
  for (const k of state.order) {
    if (byKey[k] && state.visible[k] !== false) ordered.push(byKey[k]);
  }
  for (const c of cols) {
    if (state.visible[c.key] !== false && !ordered.find((x) => x.key === c.key)) {
      ordered.push(c);
    }
  }
  return ordered;
}
