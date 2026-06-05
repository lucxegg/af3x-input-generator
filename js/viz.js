// Arc diagram renderer — draws chains as bars and crosslinks as bezier arcs

import { CHAIN_COLORS, XL_GROUP_COLORS } from './data.js';

const MARGIN_LEFT  = 72;  // space for chain labels
const MARGIN_RIGHT = 20;
const MARGIN_TOP   = 18;
const BAR_HEIGHT   = 14;
const ROW_STRIDE   = 52;  // centre-to-centre vertical distance between bars

const NS = 'http://www.w3.org/2000/svg';

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Re-draw the arc diagram from current app state.
 *
 * @param {SVGSVGElement} svg
 * @param {Array}  chains   [{ id, label, length, colorIdx }]
 * @param {Array}  xlGroups [{ name, color, pairs: [{ chain1, pos1, chain2, pos2 }] }]
 * @param {Array}  ssBonds  [{ chain1, pos1, chain2, pos2 }]  (disulfide bonds)
 */
export function drawArcDiagram(svg, chains, xlGroups, ssBonds = []) {
  // Clear previous content (keep <defs> if any)
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (chains.length === 0) {
    _placeholder(svg, 'Add sequences to see topology');
    return;
  }

  const svgWidth  = svg.getBoundingClientRect().width || 560;
  const barWidth  = svgWidth - MARGIN_LEFT - MARGIN_RIGHT;
  const nRows     = chains.length;
  const svgHeight = MARGIN_TOP * 2 + nRows * ROW_STRIDE;

  svg.setAttribute('height', svgHeight);

  // Build a lookup: chain id → row index
  const chainRow = {};
  chains.forEach((c, i) => { chainRow[c.id] = i; });

  // Maximum sequence length across all chains (for proportional x-positions)
  const maxLen = Math.max(...chains.map(c => c.length || 1));

  // ── Draw chain bars ──────────────────────────────────────────────────────
  chains.forEach((chain, rowIdx) => {
    const y       = MARGIN_TOP + rowIdx * ROW_STRIDE;
    const color   = CHAIN_COLORS[chain.colorIdx % CHAIN_COLORS.length];
    const chainLen = chain.length || maxLen;

    // Background track (light grey)
    const track = _el('rect');
    track.setAttribute('x',      MARGIN_LEFT);
    track.setAttribute('y',      y);
    track.setAttribute('width',  barWidth);
    track.setAttribute('height', BAR_HEIGHT);
    track.setAttribute('rx',     BAR_HEIGHT / 2);
    track.setAttribute('fill',   '#e8eaed');
    svg.appendChild(track);

    // Filled bar proportional to length
    const fillW = chainLen === maxLen ? barWidth : Math.max(16, (chainLen / maxLen) * barWidth);
    const bar = _el('rect');
    bar.setAttribute('x',      MARGIN_LEFT);
    bar.setAttribute('y',      y);
    bar.setAttribute('width',  fillW);
    bar.setAttribute('height', BAR_HEIGHT);
    bar.setAttribute('rx',     BAR_HEIGHT / 2);
    bar.setAttribute('fill',   color);
    bar.setAttribute('opacity', '0.85');
    svg.appendChild(bar);

    // Chain label (left-aligned, right of margin)
    const label = _el('text');
    label.setAttribute('x',           MARGIN_LEFT - 8);
    label.setAttribute('y',           y + BAR_HEIGHT / 2 + 4);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('font-size',   '12');
    label.setAttribute('font-family', 'monospace');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill',        color);
    label.textContent = chain.label || chain.id;
    svg.appendChild(label);

    // Residue count hint (right end)
    if (chain.length) {
      const hint = _el('text');
      hint.setAttribute('x',           MARGIN_LEFT + fillW + 5);
      hint.setAttribute('y',           y + BAR_HEIGHT / 2 + 4);
      hint.setAttribute('text-anchor', 'start');
      hint.setAttribute('font-size',   '10');
      hint.setAttribute('fill',        '#9aa0a6');
      hint.textContent = chain.length + ' aa';
      svg.appendChild(hint);
    }
  });

  // ── Draw crosslink arcs ───────────────────────────────────────────────────
  xlGroups.forEach((grp, gi) => {
    const color = grp.color || XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
    grp.pairs.forEach(pair => {
      _drawArc(svg, pair, chainRow, chains, barWidth, maxLen, color, grp.name, false);
    });
  });

  // ── Draw disulfide bond arcs ──────────────────────────────────────────────
  ssBonds.forEach(pair => {
    _drawArc(svg, pair, chainRow, chains, barWidth, maxLen, '#f0b400', 'S–S', true);
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _drawArc(svg, pair, chainRow, chains, barWidth, maxLen, color, label, isDash) {
  const r1 = chainRow[pair.chain1];
  const r2 = chainRow[pair.chain2];
  if (r1 === undefined || r2 === undefined) return;

  const c1 = chains[r1];
  const c2 = chains[r2];

  const x1 = _posX(pair.pos1, c1.length || maxLen, maxLen, barWidth);
  const x2 = _posX(pair.pos2, c2.length || maxLen, maxLen, barWidth);
  const y1_bar = MARGIN_TOP + r1 * ROW_STRIDE;
  const y2_bar = MARGIN_TOP + r2 * ROW_STRIDE;

  let path;

  if (r1 === r2) {
    // Intra-chain: arc above the bar
    const yTop  = y1_bar - 6;
    const arcH  = Math.max(12, Math.abs(x2 - x1) * 0.35);
    const cx1   = x1;
    const cx2   = x2;
    const cy    = yTop - arcH;
    path = `M ${x1} ${yTop} C ${cx1} ${cy}, ${cx2} ${cy}, ${x2} ${yTop}`;
  } else {
    // Inter-chain: arc between the two bars
    const y1 = y1_bar + BAR_HEIGHT / 2;
    const y2 = y2_bar + BAR_HEIGHT / 2;
    const midY = (y1 + y2) / 2;
    // Slight horizontal shift on control points for readability
    const shift = (x2 - x1) * 0.15;
    path = `M ${x1} ${y1} C ${x1 + shift} ${midY}, ${x2 - shift} ${midY}, ${x2} ${y2}`;
  }

  const arc = _el('path');
  arc.setAttribute('d',            path);
  arc.setAttribute('fill',         'none');
  arc.setAttribute('stroke',       color);
  arc.setAttribute('stroke-width', '1.8');
  arc.setAttribute('opacity',      '0.8');
  if (isDash) arc.setAttribute('stroke-dasharray', '4 3');
  arc.setAttribute('class', 'xl-arc');

  // Tooltip via <title>
  const title = _el('title');
  title.textContent = `${label}: ${pair.chain1}:${pair.pos1} ↔ ${pair.chain2}:${pair.pos2}`;
  arc.appendChild(title);

  // Endpoint dots
  [{ x: x1, row: r1 }, { x: x2, row: r2 }].forEach(({ x, row }) => {
    const dot = _el('circle');
    dot.setAttribute('cx',   x);
    dot.setAttribute('cy',   MARGIN_TOP + row * ROW_STRIDE + BAR_HEIGHT / 2);
    dot.setAttribute('r',    3);
    dot.setAttribute('fill', color);
    dot.setAttribute('opacity', '0.9');
    svg.appendChild(dot);
  });

  svg.appendChild(arc);
}

/** X pixel position for a residue, clamped to bar bounds. */
function _posX(resNum, chainLen, maxLen, barWidth) {
  const frac = Math.min(1, Math.max(0, (resNum - 1) / Math.max(chainLen - 1, 1)));
  return MARGIN_LEFT + frac * barWidth;
}

function _placeholder(svg, text) {
  svg.setAttribute('height', 100);
  const t = _el('text');
  t.setAttribute('x',           '50%');
  t.setAttribute('y',           '50%');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('font-size',   '13');
  t.setAttribute('font-family', 'sans-serif');
  t.setAttribute('fill',        '#bdc1c6');
  t.textContent = text;
  svg.appendChild(t);
}

function _el(tag) {
  return document.createElementNS(NS, tag);
}
