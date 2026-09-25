// Layout for single-day columns of a week calendar: turns time-positioned
// cards into visual segments (splitting overnight spans across midnight) and
// assigns side-by-side lanes so overlapping cards never hide each other.
export const MINUTES_PER_DAY = 1440;

// cards: [{ key, startMin, durMin, ...payload }]
// returns: [{ c, start, end, isTail, lane, laneCount }]
export function layoutWeekDayCards(cards) {
  const segments = [];
  for (const c of cards) {
    if (c.durMin >= MINUTES_PER_DAY) {
      segments.push({ c, start: 0, end: MINUTES_PER_DAY, isTail: false });
    } else if (c.startMin + c.durMin > MINUTES_PER_DAY) {
      segments.push({ c, start: c.startMin, end: MINUTES_PER_DAY, isTail: false });
      segments.push({ c, start: 0, end: (c.startMin + c.durMin) % MINUTES_PER_DAY, isTail: true });
    } else {
      segments.push({ c, start: c.startMin, end: c.startMin + c.durMin, isTail: false });
    }
  }
  if (!segments.length) return segments;

  // Group visually overlapping segments into clusters (sweep line)
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters = [];
  let cluster = [];
  let maxEnd = -1;
  for (const s of sorted) {
    if (cluster.length && s.start >= maxEnd) {
      clusters.push(cluster);
      cluster = [];
      maxEnd = -1;
    }
    cluster.push(s);
    maxEnd = Math.max(maxEnd, s.end);
  }
  if (cluster.length) clusters.push(cluster);

  // Assign a lane per segment within its cluster (first-fit by end time)
  for (const cl of clusters) {
    cl.sort((a, b) => a.start - b.start || b.end - a.end);
    const laneEnds = [];
    for (const s of cl) {
      let lane = laneEnds.findIndex((end) => end <= s.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(s.end);
      } else {
        laneEnds[lane] = s.end;
      }
      s.lane = lane;
    }
    for (const s of cl) s.laneCount = laneEnds.length;
  }
  return segments;
}