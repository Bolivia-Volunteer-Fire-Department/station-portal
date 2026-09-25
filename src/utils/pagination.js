// Paging a list of rows.
//
// Extracted from the System Log's helpers, which were already generic - they count rows, not log entries. One
// implementation means the log tab and the events tab cannot disagree about what "page 3 of 7" means, and
// about what happens when a list shrinks under the page you are on.
export const DEFAULT_PAGE_SIZE = 20;

// How many pages a list of `total` rows needs. Always at least one, so an empty list still reads as "1 of 1"
// rather than "page 0 of 0".
export const totalPages = (total, pageSize = DEFAULT_PAGE_SIZE) => {
  const size = Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE));
  const count = Math.max(0, Math.floor(Number(total) || 0));
  return Math.max(1, Math.ceil(count / size));
};

// Keeps a page number inside the data.
//
// This matters after a delete or a reload: page 4 of a list that is now two pages long would render an empty
// table with no explanation.
export const clampPage = (page, total, pageSize = DEFAULT_PAGE_SIZE) => {
  const pages = totalPages(total, pageSize);
  const wanted = Math.floor(Number(page) || 1);
  if (!Number.isFinite(wanted) || wanted < 1) return 1;
  return Math.min(wanted, pages);
};

// "11–20 of 84" - which rows are on screen, not just which page.
export const pageRangeLabel = (total, page, pageSize = DEFAULT_PAGE_SIZE) => {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  if (count === 0) return '0 of 0';

  const size = Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE));
  const current = clampPage(page, count, size);
  const first = (current - 1) * size + 1;
  const last = Math.min(current * size, count);
  return `${first}–${last} of ${count}`;
};

// The rows for one page, clamped first, so an out-of-range page yields the LAST page rather than nothing.
export const pageSlice = (items, page, pageSize = DEFAULT_PAGE_SIZE) => {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE));
  const current = clampPage(page, list.length, size);
  const start = (current - 1) * size;
  return list.slice(start, start + size);
};
