'use strict';

// What the charger really charged in the past, per price block.
//
// Reads the 5-minute statistics of the charger power sensor, so the chart can
// show the blocks in which the car did charge. Home Assistant keeps these
// statistics for 10 days by default.

const ha = require('./ha');

const MIN_KWH = 0.05; // less than this in a block is not charging

// Pure: kWh per block from 5-minute means (W). Only past time counts.
function perBlock(rows, blocks, now) {
  const out = [];
  for (const b of blocks) {
    if (b.start >= now) continue;
    const bEnd = Math.min(b.end, now);
    let kwh = 0;
    for (const r of rows) {
      if (!Number.isFinite(r.mean) || r.mean <= 0) continue;
      const rEnd = r.end || r.start + 300000;
      const start = Math.max(r.start, b.start);
      const end = Math.min(rEnd, bEnd);
      if (end > start) kwh += (r.mean / 1000) * ((end - start) / 3600000);
    }
    if (kwh >= MIN_KWH) out.push({ start: b.start, end: b.end, kwh: Math.round(kwh * 100) / 100 });
  }
  return out;
}

async function chargedBlocks(powerEntity, blocks, now = Date.now()) {
  if (!powerEntity || !blocks.length) return [];
  const from = blocks[0].start;
  if (from >= now) return [];
  const data = await ha.call({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(now).toISOString(),
    statistic_ids: [powerEntity],
    period: '5minute',
    types: ['mean'],
    units: { power: 'W' },
  });
  const rows = (data && data[powerEntity]) || [];
  return perBlock(rows, blocks, now);
}

module.exports = { chargedBlocks, perBlock };
