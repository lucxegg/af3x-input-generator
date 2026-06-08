/**
 * Interactive topology modal — zoomable, pannable, chain-draggable arc diagram.
 *
 * Controls
 * --------
 *   Mouse wheel        zoom in/out (centred on cursor)
 *   Drag background    pan
 *   Drag protein bar   move chain vertically to reorder
 *   Reset View         restore default layout
 *   Escape / ✕         close
 */

import { CHAIN_COLORS, XL_GROUP_COLORS } from './data.js';

const NS   = 'http://www.w3.org/2000/svg';
const ML   = 94;   // left margin  (room for chain labels)
const MR   = 36;   // right margin
const MT   = 80;   // top margin   (room for intra arcs above row 0)
const MB   = 40;   // bottom margin
const BAR_H      = 22;
const STRIDE_DEF = 100;  // default row spacing (centre to centre)
const MAX_INTRA  = 58;   // max height of intra-chain arc above bar

// ─── Module state ─────────────────────────────────────────────────────────────

let _chains   = [];
let _xlGroups = [];
let _ssBonds  = [];
let _maxLen   = 1;
let _svgW     = 1200;
let _chainY   = {};   // chain.id → current y (SVG coords)
let _vb       = { x: 0, y: 0, w: 1200, h: 600 };

const _drag   = { type: null };

// ─── Public API ───────────────────────────────────────────────────────────────

export function openInteractiveTopology(chains, xlGroups, ssBonds) {
  _chains   = chains;
  _xlGroups = xlGroups || [];
  _ssBonds  = ssBonds  || [];
  _maxLen   = Math.max(1, ...chains.map(c => c.length || 1));

  _resetChainPositions();
  document.getElementById('topology-modal').style.display = 'flex';

  // Wait for the modal to be laid out before reading dimensions
  requestAnimationFrame(() => {
    const svg = _svg();
    _svgW = svg.getBoundingClientRect().width || 1200;
    _resetVb();
    _draw();
  });
}

export function initInteractiveTopology() {
  const modal = document.getElementById('topology-modal');
  const svg   = _svg();
  if (!modal || !svg) return;

  document.getElementById('topoModalClose')?.addEventListener('click', _close);
  document.getElementById('topoResetView')?.addEventListener('click', () => {
    _resetChainPositions();
    _resetVb();
    _draw();
  });

  modal.addEventListener('keydown', e => { if (e.key === 'Escape') _close(); });
  modal.addEventListener('click',   e => { if (e.target === modal)  _close(); });

  svg.addEventListener('wheel',     _onWheel,     { passive: false });
  svg.addEventListener('mousedown', _onMouseDown);
  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mouseup',   _onMouseUp);

  // Arc tooltip on hover (using shared arc-tooltip div)
  svg.addEventListener('mousemove', _onSvgMouseMove);
  svg.addEventListener('mouseleave', _hideTooltip);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function _draw() {
  const svg = _svg();
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `${_vb.x} ${_vb.y} ${_vb.w} ${_vb.h}`);

  _appendDefs(svg);

  const barW = _svgW - ML - MR;
  const displayW = svg.getBoundingClientRect().width || 900;
  const pxPerRes = (barW / _maxLen) * (displayW / _vb.w);
  const tickInt  = _tickInterval(pxPerRes);

  // Crosslink arcs — drawn before bars so bars appear on top
  _xlGroups.forEach((grp, gi) => {
    const color = grp.color || XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
    grp.pairs.forEach(pair => _drawArc(svg, pair, color, grp.name, false, barW));
  });
  _ssBonds.forEach(pair => _drawArc(svg, pair, '#f0b400', 'S–S', true, barW));

  // Chain bars
  _chains.forEach(chain => {
    const y     = _chainY[chain.id];
    const color = CHAIN_COLORS[chain.colorIdx % CHAIN_COLORS.length];
    const len   = chain.length || _maxLen;
    const fillW = Math.max(20, (len / _maxLen) * barW);

    // Ghost track
    const track = _el('rect');
    _attrs(track, { x: ML, y, width: barW, height: BAR_H, rx: BAR_H / 2,
                    fill: '#e8eaed', class: 'topo-chain-bar',
                    'data-chainid': chain.id });
    svg.appendChild(track);

    // Residue tick marks
    if (tickInt) {
      const g = _el('g');
      g.setAttribute('class', 'topo-ticks');
      for (let r = tickInt; r <= len; r += tickInt) {
        const tx      = ML + ((r - 1) / Math.max(len - 1, 1)) * fillW;
        const isMajor = r % (tickInt * (tickInt >= 50 ? 2 : 5)) === 0 || tickInt >= 250;
        const tH      = isMajor ? 9 : 5;

        const tick = _el('line');
        _attrs(tick, { x1: tx, y1: y - 1, x2: tx, y2: y - 1 - tH,
                       stroke: color, 'stroke-width': isMajor ? 1.2 : 0.7,
                       opacity: 0.7 });
        g.appendChild(tick);

        if (isMajor) {
          const lbl = _el('text');
          _attrs(lbl, {
            x: tx, y: y - tH - 3,
            'text-anchor': 'middle',
            'font-size': Math.round(_vb.w / 100),
            fill: color, opacity: 0.9,
          });
          lbl.textContent = r;
          g.appendChild(lbl);
        }
      }
      svg.appendChild(g);
    }

    // Filled bar
    const bar = _el('rect');
    _attrs(bar, { x: ML, y, width: fillW, height: BAR_H, rx: BAR_H / 2,
                  fill: color, opacity: 0.88,
                  class: 'topo-chain-bar', 'data-chainid': chain.id });
    svg.appendChild(bar);

    // Chain label
    const lbl = _el('text');
    _attrs(lbl, { x: ML - 10, y: y + BAR_H / 2 + 5,
                  'text-anchor': 'end', 'font-size': 14,
                  'font-family': 'monospace', 'font-weight': 700, fill: color });
    lbl.textContent = chain.label || chain.id;
    svg.appendChild(lbl);

    // Length hint
    if (chain.length) {
      const hint = _el('text');
      _attrs(hint, { x: ML + fillW + 8, y: y + BAR_H / 2 + 5,
                     'text-anchor': 'start', 'font-size': 10, fill: '#9aa0a6' });
      hint.textContent = chain.length + ' aa';
      svg.appendChild(hint);
    }
  });
}

function _drawArc(svg, pair, color, xlLabel, isDash, barW) {
  if (_chainY[pair.chain1] === undefined || _chainY[pair.chain2] === undefined) return;

  const c1 = _chains.find(c => c.id === pair.chain1);
  const c2 = _chains.find(c => c.id === pair.chain2);
  if (!c1 || !c2) return;

  const x1 = _posX(pair.pos1, c1.length || _maxLen, barW);
  const x2 = _posX(pair.pos2, c2.length || _maxLen, barW);
  const y1 = _chainY[pair.chain1];
  const y2 = _chainY[pair.chain2];

  let pathD;
  if (pair.chain1 === pair.chain2) {
    const yTop = y1 - 10;
    const arcH = Math.min(MAX_INTRA, Math.max(12, Math.abs(x2 - x1) * 0.35));
    pathD = `M ${x1} ${yTop} C ${x1} ${yTop - arcH}, ${x2} ${yTop - arcH}, ${x2} ${yTop}`;
  } else {
    const ay1  = y1 + BAR_H / 2;
    const ay2  = y2 + BAR_H / 2;
    const midY = (ay1 + ay2) / 2;
    const sft  = (x2 - x1) * 0.15;
    pathD = `M ${x1} ${ay1} C ${x1+sft} ${midY}, ${x2-sft} ${midY}, ${x2} ${ay2}`;
  }

  const grp = _el('g');
  grp.setAttribute('class',     'topo-xl-group');
  grp.setAttribute('data-label', `${xlLabel}: ${pair.chain1}:${pair.pos1} ↔ ${pair.chain2}:${pair.pos2}`);

  // Endpoint dots
  [[x1, y1 + BAR_H / 2], [x2, y2 + BAR_H / 2]].forEach(([cx, cy]) => {
    const dot = _el('circle');
    _attrs(dot, { cx, cy, r: 4, fill: color, class: 'topo-dot' });
    grp.appendChild(dot);
  });

  // Arc
  const arc = _el('path');
  _attrs(arc, { d: pathD, fill: 'none', stroke: color, 'stroke-width': 2,
                opacity: 0.75, class: 'topo-arc' });
  if (isDash) arc.setAttribute('stroke-dasharray', '5 3');
  grp.appendChild(arc);

  // Invisible wide hit area for easier hover
  const hit = _el('path');
  _attrs(hit, { d: pathD, fill: 'none', stroke: 'transparent', 'stroke-width': 16 });
  grp.appendChild(hit);

  svg.appendChild(grp);
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function _onSvgMouseMove(e) {
  const grp     = e.target.closest('.topo-xl-group');
  const tooltip = document.getElementById('arc-tooltip');
  if (!tooltip) return;
  if (grp) {
    tooltip.textContent  = grp.getAttribute('data-label') || '';
    tooltip.style.display = 'block';
    tooltip.style.left    = (e.clientX + 16) + 'px';
    tooltip.style.top     = (e.clientY - 32) + 'px';
  } else {
    _hideTooltip();
  }
}

function _hideTooltip() {
  const t = document.getElementById('arc-tooltip');
  if (t) t.style.display = 'none';
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

function _onWheel(e) {
  e.preventDefault();
  const sv  = _svg();
  const pt  = _toSvg(sv, e.clientX, e.clientY);
  const fac = e.deltaY > 0 ? 1.14 : 1 / 1.14;

  // Keep SVG point under cursor fixed
  const fx = (pt.x - _vb.x) / _vb.w;
  const fy = (pt.y - _vb.y) / _vb.h;
  _vb.w *= fac;
  _vb.h *= fac;
  _vb.x  = pt.x - fx * _vb.w;
  _vb.y  = pt.y - fy * _vb.h;

  _draw();
}

// ─── Pan / Drag chain ────────────────────────────────────────────────────────

function _onMouseDown(e) {
  if (e.button !== 0) return;
  const chainTarget = e.target.closest('[data-chainid]');

  if (chainTarget) {
    const id = chainTarget.getAttribute('data-chainid');
    const pt = _toSvg(_svg(), e.clientX, e.clientY);
    _drag.type       = 'chain';
    _drag.chainId    = id;
    _drag.startSvgY  = pt.y;
    _drag.startChainY = _chainY[id];
    document.body.style.cursor = 'grabbing';
  } else {
    _drag.type      = 'bg';
    _drag.startVbX  = _vb.x;
    _drag.startVbY  = _vb.y;
    _drag.startClX  = e.clientX;
    _drag.startClY  = e.clientY;
    document.body.style.cursor = 'grabbing';
  }
  e.preventDefault();
}

function _onMouseMove(e) {
  if (!_drag.type) return;
  const sv = _svg();

  if (_drag.type === 'chain') {
    const pt = _toSvg(sv, e.clientX, e.clientY);
    _chainY[_drag.chainId] = _drag.startChainY + (pt.y - _drag.startSvgY);
    _draw();
  } else if (_drag.type === 'bg') {
    const rect = sv.getBoundingClientRect();
    const scX  = _vb.w / rect.width;
    const scY  = _vb.h / rect.height;
    _vb.x = _drag.startVbX - (e.clientX - _drag.startClX) * scX;
    _vb.y = _drag.startVbY - (e.clientY - _drag.startClY) * scY;
    _draw();
  }
}

function _onMouseUp() {
  _drag.type = null;
  document.body.style.cursor = '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _close() {
  document.getElementById('topology-modal').style.display = 'none';
  _hideTooltip();
}

function _resetChainPositions() {
  _chainY = {};
  _chains.forEach((c, i) => { _chainY[c.id] = MT + i * STRIDE_DEF; });
}

function _resetVb() {
  const totalH = MT + _chains.length * STRIDE_DEF + MB;
  _vb = { x: 0, y: 0, w: _svgW, h: Math.max(300, totalH) };
}

function _posX(resNum, chainLen, barW) {
  const frac = Math.min(1, Math.max(0, (resNum - 1) / Math.max(chainLen - 1, 1)));
  return ML + frac * barW;
}

function _tickInterval(pxPerRes) {
  if (pxPerRes > 18) return 5;
  if (pxPerRes > 8)  return 10;
  if (pxPerRes > 3)  return 25;
  if (pxPerRes > 1.2) return 50;
  if (pxPerRes > 0.4) return 100;
  if (pxPerRes > 0.15) return 250;
  return null;
}

function _appendDefs(svg) {
  const defs   = _el('defs');
  const filter = _el('filter');
  _attrs(filter, { id: 'topo-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  const blur = _el('feGaussianBlur');
  _attrs(blur, { in: 'SourceGraphic', stdDeviation: 3, result: 'b' });
  const merge = _el('feMerge');
  ['b', 'SourceGraphic'].forEach(src => {
    const mn = _el('feMergeNode'); mn.setAttribute('in', src); merge.appendChild(mn);
  });
  filter.appendChild(blur); filter.appendChild(merge); defs.appendChild(filter);
  svg.appendChild(defs);
}

function _toSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function _el(tag) { return document.createElementNS(NS, tag); }

function _attrs(el, obj) {
  for (const [k, v] of Object.entries(obj)) el.setAttribute(k, v);
}
