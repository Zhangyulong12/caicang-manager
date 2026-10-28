import type { ReportColumn } from '@caicang/api-contract';
/** Quoted RFC4180 cells; dangerous text is a literal, never a spreadsheet formula. */
export function csvCell(value: string | null): string {
  let text = value ?? '';
  // Includes whitespace/control/BOM prefixes and locale-specific full-width operators.
  if (
    // eslint-disable-next-line no-control-regex -- CSV formula detection deliberately includes ASCII control prefixes.
    /^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@＝＋－＠]/u.test(text) ||
    // eslint-disable-next-line no-control-regex -- A leading control character must also be escaped as literal text.
    /^[\u0000-\u001f\u007f]/u.test(text)
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(
  columns: readonly ReportColumn[],
  rows: readonly Record<string, string | null>[],
) {
  return (
    '\uFEFF' +
    [
      columns.map((c) => csvCell(c.label)).join(','),
      ...rows.map((row) => columns.map((c) => csvCell(row[c.key] ?? null)).join(',')),
    ].join('\r\n') +
    '\r\n'
  );
}
