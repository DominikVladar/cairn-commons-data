// Parser for the record tables of the Covering Repository (https://www.coveringrepository.com).
// Pure function: HTML in, rows out. Shared by the collector and its tests (and runnable in a browser).

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

/** "28.442" (dots are thousands separators on this site) → 28442; anything else → null. */
const int = (s) => (/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s) ? Number(s.replace(/\./g, "")) : null);

/** "05/11/2026" (day/month/year) → "2026-11-05". */
const isoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * Rows of the systems grid (`table#cph_grdSystems`): one per parameter set, with the record holder.
 * Returns { rows, skipped }: rows that do not parse are counted, never guessed.
 */
export function parseCoveringGrid(html) {
  const start = html.indexOf('id="cph_grdSystems"');
  if (start < 0) return { rows: [], skipped: 0, grid: false };
  const end = html.indexOf("</table>", start);
  const grid = html.slice(start, end < 0 ? undefined : end);
  const rows = [];
  let skipped = 0;
  for (const tr of grid.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 10) continue; // header or group row ("v, 06, 02, 02")
    const [v, k, t, m, blocks, lower] = cells.slice(0, 6).map((c) => int(decode(c)));
    const date = isoDate(decode(cells[8]));
    if ([v, k, t, m, blocks].some((x) => x === null) || !date) {
      skipped++;
      continue;
    }
    const history = /history\.aspx\?id=(\d+)/.exec(tr)?.[1] ?? null;
    rows.push({
      v,
      k,
      t,
      m,
      blocks,
      lowerBound: lower,
      author: decode(cells[6]),
      notes: decode(cells[7]),
      date,
      historyId: history ? Number(history) : null,
    });
  }
  return { rows, skipped, grid: true };
}
