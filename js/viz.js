// Arc diagram renderer — draws chains as bars and crosslinks as bezier arcs

import { CHAIN_COLORS, XL_GROUP_COLORS } from './data.js';

const MARGIN_LEFT   = 76;
const MARGIN_RIGHT  = 24;
const MARGIN_TOP    = 68;  // tall enough to fit intra-chain arcs above row 0
const BAR_HEIGHT    = 18;
const ROW_STRIDE    = 74;  // centre-to-centre vertical distance between bars
const MAX_INTRA_ARC = 52;  // max height of intra-chain arc above bar

const NS = 'http://www.w3.org/2000/svg';

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Re-draw the arc diagram from current app state.
 *
 * @param {SVGSVGElement} svg
 * @param {Array}  chains   [{ id, label, length, colorIdx }]
 * @param {Array}  xlGroups [{ name, color, pairs: [{ chain1, pos1, chain2, pos2 }] }]
 * @param {Array}  ssBonds  [{ chain1, pos1, chain2, pos2 }]
 */
export function drawArcDiagram(svg, chains, xlGroups, ssBonds = []) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (chains.length === 0) {
    _placeholder(svg, 'Add sequences to see topology');
    return;
  }

  const svgWidth  = svg.getBoundingClientRect().width || 560;
  const barWidth  = svgWidth - MARGIN_LEFT - MARGIN_RIGHT;
  const nRows     = chains.length;
  const svgHeight = MARGIN_TOP * 2 + nRows * ROW_STRIDE;

  svg.setAttribute('height',  svgHeight);
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  // Store full viewBox for zoom-restore
  svg.dataset.fullVb = `0 0 ${svgWidth} ${svgHeight}`;

  // SVG defs: glow filter
  const defs   = _el('defs');
  const filter = _el('filter');
  filter.setAttribute('id', 'arc-glow');
  filter.setAttribute('x', '-60%'); filter.setAttribute('y', '-60%');
  filter.setAttribute('width', '220%'); filter.setAttribute('height', '220%');
  const blur = _el('feGaussianBlur');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', '3');
  blur.setAttribute('result', 'blurred');
  const merge  = _el('feMerge');
  const mNode1 = _el('feMergeNode'); mNode1.setAttribute('in', 'blurred');
  const mNode2 = _el('feMergeNode'); mNode2.setAttribute('in', 'SourceGraphic');
  merge.appendChild(mNode1);
  merge.appendChild(mNode2);
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // Chain row → index map
  const chainRow = {};
  chains.forEach((c, i) => { chainRow[c.id] = i; });

  const maxLen = Math.max(...chains.map(c => c.length || 1));

  // Per-chain bar widths proportional to sequence length
  const chainBarW = {};
  chains.forEach(c => {
    chainBarW[c.id] = Math.max(4, ((c.length || maxLen) / maxLen) * barWidth);
  });

  // ── Chain bars ───────────────────────────────────────────────────────────
  chains.forEach((chain, rowIdx) => {
    const y        = MARGIN_TOP + rowIdx * ROW_STRIDE;
    const color    = CHAIN_COLORS[chain.colorIdx % CHAIN_COLORS.length];
    const fillW    = chainBarW[chain.id];

    // Bar — proportional width, no grey ghost track
    const bar = _el('rect');
    bar.setAttribute('x',      MARGIN_LEFT);
    bar.setAttribute('y',      y);
    bar.setAttribute('width',  fillW);
    bar.setAttribute('height', BAR_HEIGHT);
    bar.setAttribute('rx',     BAR_HEIGHT / 2);
    bar.setAttribute('fill',   color);
    bar.setAttribute('opacity', '0.85');
    svg.appendChild(bar);

    // Chain label
    const label = _el('text');
    label.setAttribute('x',           MARGIN_LEFT - 8);
    label.setAttribute('y',           y + BAR_HEIGHT / 2 + 4);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('font-size',   '13');
    label.setAttribute('font-family', 'monospace');
    label.setAttribute('font-weight', '700');
    label.setAttribute('fill',        color);
    label.textContent = chain.label || chain.id;
    svg.appendChild(label);

    // Length hint
    if (chain.length) {
      const hint = _el('text');
      hint.setAttribute('x',           MARGIN_LEFT + fillW + 6);
      hint.setAttribute('y',           y + BAR_HEIGHT / 2 + 4);
      hint.setAttribute('text-anchor', 'start');
      hint.setAttribute('font-size',   '10');
      hint.setAttribute('fill',        '#9aa0a6');
      hint.textContent = chain.length + ' aa';
      svg.appendChild(hint);
    }
  });

  // ── Crosslink arcs ───────────────────────────────────────────────────────
  xlGroups.forEach((grp, gi) => {
    grp.pairs.forEach(pair => {
      const color = pair.color || grp.color || XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
      _drawArc(svg, pair, chainRow, chains, chainBarW, maxLen, color, grp.name, pair.dashArray || 'none');
    });
  });

  // ── Disulfide arcs ───────────────────────────────────────────────────────
  ssBonds.forEach(pair => {
    _drawArc(svg, pair, chainRow, chains, chainBarW, maxLen, '#f0b400', 'S–S', '5 3');
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _drawArc(svg, pair, chainRow, chains, chainBarW, maxLen, color, label, dashArray) {
  const r1 = chainRow[pair.chain1];
  const r2 = chainRow[pair.chain2];
  if (r1 === undefined || r2 === undefined) return;

  const c1 = chains[r1];
  const c2 = chains[r2];

  const x1    = _posX(pair.pos1, c1.length || maxLen, chainBarW[pair.chain1]);
  const x2    = _posX(pair.pos2, c2.length || maxLen, chainBarW[pair.chain2]);
  const yBar1 = MARGIN_TOP + r1 * ROW_STRIDE;
  const yBar2 = MARGIN_TOP + r2 * ROW_STRIDE;

  let pathD;

  if (r1 === r2) {
    const yTop = yBar1 - 8;
    const arcH = Math.min(MAX_INTRA_ARC, Math.max(12, Math.abs(x2 - x1) * 0.35));
    const cy   = yTop - arcH;
    pathD = `M ${x1} ${yTop} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${yTop}`;
  } else {
    const y1    = yBar1 + BAR_HEIGHT / 2;
    const y2    = yBar2 + BAR_HEIGHT / 2;
    const midY  = (y1 + y2) / 2;
    const shift = (x2 - x1) * 0.15;
    pathD = `M ${x1} ${y1} C ${x1 + shift} ${midY}, ${x2 - shift} ${midY}, ${x2} ${y2}`;
  }

  // ── Group: arc + endpoint dots ──────────────────────────────────────────
  const group = _el('g');
  group.setAttribute('class',    'xl-arc-group');
  group.setAttribute('data-key', `${pair.chain1}:${pair.pos1}:${pair.chain2}:${pair.pos2}`);
  group.setAttribute('data-label', `${label}: ${pair.chain1}:${pair.pos1} ↔ ${pair.chain2}:${pair.pos2}`);

  // Dots (added to group before arc so arc renders on top)
  const dotY1 = yBar1 + BAR_HEIGHT / 2;
  const dotY2 = yBar2 + BAR_HEIGHT / 2;
  [[x1, dotY1], [x2, dotY2]].forEach(([cx, cy]) => {
    const dot = _el('circle');
    dot.setAttribute('cx',    cx);
    dot.setAttribute('cy',    cy);
    dot.setAttribute('r',     '3.5');
    dot.setAttribute('fill',  color);
    dot.setAttribute('class', 'xl-dot');
    group.appendChild(dot);
  });

  // Arc path
  const arc = _el('path');
  arc.setAttribute('d',            pathD);
  arc.setAttribute('fill',         'none');
  arc.setAttribute('stroke',       color);
  arc.setAttribute('stroke-width', '2');
  arc.setAttribute('opacity',      '0.75');
  if (dashArray && dashArray !== 'none') arc.setAttribute('stroke-dasharray', dashArray);
  arc.setAttribute('class', 'xl-arc');
  group.appendChild(arc);

  // Invisible fat hit-area for easier hovering
  const hit = _el('path');
  hit.setAttribute('d',            pathD);
  hit.setAttribute('fill',         'none');
  hit.setAttribute('stroke',       'transparent');
  hit.setAttribute('stroke-width', '14');
  group.appendChild(hit);

  svg.appendChild(group);
}

function _posX(resNum, chainLen, barWidth) {
  const frac = Math.min(1, Math.max(0, (resNum - 1) / Math.max(chainLen - 1, 1)));
  return MARGIN_LEFT + frac * barWidth;
}

function _placeholder(svg, text) {
  svg.setAttribute('height', 100);
  const t = _el('text');
  t.setAttribute('x',                  '50%');
  t.setAttribute('y',                  '50%');
  t.setAttribute('text-anchor',        'middle');
  t.setAttribute('dominant-baseline',  'middle');
  t.setAttribute('font-size',          '13');
  t.setAttribute('font-family',        'sans-serif');
  t.setAttribute('fill',               '#bdc1c6');
  t.textContent = text;
  svg.appendChild(t);
}

function _el(tag) {
  return document.createElementNS(NS, tag);
}
