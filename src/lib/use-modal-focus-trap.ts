"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => {
      if (el.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      return el.offsetParent !== null || style.position === "fixed";
    }
  );
}

/**
 * Khi modal mở: chuyển focus vào panel, trap Tab trong panel, restore focus khi đóng.
 * Gắn `panelRef` vào phần tử role="dialog".
 */
export function useModalFocusTrap(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;

    const prev =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Cho phép focus panel nếu chưa có input
    if (!panel.hasAttribute("tabindex")) {
      panel.setAttribute("tabindex", "-1");
    }

    // Đợi 1 frame — nội dung modal (picker) có thể mount sau
    const t = window.setTimeout(() => {
      const nodes = listFocusable(panel);
      const prefer = panel.querySelector<HTMLElement>("[data-initial-focus]");
      if (prefer) prefer.focus();
	else if (nodes.length > 0) {
        nodes[0]!.focus();
      } else {
        panel.focus();
      }
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const root = panelRef.current;
      const nodes = listFocusable(root);
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      const inside = activeEl && root.contains(activeEl);

      if (e.shiftKey) {
        if (!inside || activeEl === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!inside || activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus nút mở modal (Thêm đơn / dòng đơn)
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [active, panelRef]);
}
