/**
 * Xuất bảng ra file Excel-compatible (HTML Spreadsheet / .xls)
 * Không cần thư viện thêm — Excel và LibreOffice mở tốt.
 */
export function downloadExcelHtml(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  metaLines?: string[]
) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  const metaHtml = (metaLines || [])
    .map((l) => `<tr><td colspan="${headers.length}"><b>${esc(l)}</b></td></tr>`)
    .join("");

  const head = headers
    .map((h) => `<th style="background:#1e293b;color:#fff;font-weight:bold">${esc(h)}</th>`)
    .join("");

  const body = rows
    .map((r) => {
      const cells = r
        .map((c, i) => {
          const isNum = typeof c === "number";
          const style = isNum
            ? 'style="mso-number-format:\'#,##0\'; text-align:right"'
            : "";
          return `<td ${style}>${esc(c)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>${esc(sheetName)}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table border="1" cellpadding="4" cellspacing="0">
${metaHtml}
<tr>${head}</tr>
${body}
</table>
</body></html>`;

  const blob = new Blob(["\ufeff" + html], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
