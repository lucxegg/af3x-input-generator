/**
 * XL statistics panel — updates #xl-stats whenever crosslinks change.
 */

export function updateXlStats() {
  const container = document.getElementById('xl-stats');
  if (!container) return;

  const allPairs = [];
  document.querySelectorAll('.xl-group-card').forEach(card => {
    const xlSel = card.querySelector('.xl-select');
    const xlName = xlSel?.value || '?';
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) {
        allPairs.push({ xlName, c1, p1, c2, p2, isIntra: c1 === c2 });
      }
    });
  });

  if (!allPairs.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  const n      = allPairs.length;
  const nIntra = allPairs.filter(p => p.isIntra).length;
  const nInter = n - nIntra;

  // Count per chain-pair (canonical order: smaller chain first)
  const pairCounts = {};
  allPairs.forEach(p => {
    const key = p.c1 <= p.c2 ? `${p.c1}↔${p.c2}` : `${p.c2}↔${p.c1}`;
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  });

  const sortedPairs = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]);

  const pairRows = sortedPairs.map(([key, cnt]) =>
    `<span class="xl-stat-pair">${key}: <strong>${cnt}</strong></span>`
  ).join('');

  container.innerHTML = `
    <div class="xl-stats-summary">
      <span class="xl-stat-total">${n} crosslink${n!==1?'s':''}</span>
      <span class="xl-stat-sep">·</span>
      <span class="xl-stat-inter">${nInter} inter</span>
      <span class="xl-stat-sep">·</span>
      <span class="xl-stat-intra">${nIntra} intra</span>
    </div>
    <div class="xl-stats-pairs">${pairRows}</div>`;
}
