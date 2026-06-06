/**
 * PDB / mmCIF import module
 * Parses chain sequences from structure files and drives the import modal.
 */

// ─── Amino acid mapping ───────────────────────────────────────────────────────

const AA3TO1 = {
  ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLN:'Q', GLU:'E', GLY:'G',
  HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S',
  THR:'T', TRP:'W', TYR:'Y', VAL:'V',
  // Modified / common variants → map to nearest standard
  MSE:'M', SEP:'S', TPO:'T', PTR:'Y', CME:'C', OCS:'C', CSE:'C',
  PCA:'E', HYP:'P', UNK:'X',
};

// ─── Format detection ─────────────────────────────────────────────────────────

function _detectFileFormat(text) {
  const first300 = text.slice(0, 300);
  if (/^data_/m.test(first300) || /^loop_/m.test(first300) || /_atom_site/m.test(first300)) {
    return 'mmcif';
  }
  return 'pdb';
}

// ─── PDB parser (SEQRES) ──────────────────────────────────────────────────────

function parsePDB(text) {
  const seqres = {};  // chainId → [3-letter codes]
  for (const line of text.split('\n')) {
    if (!line.startsWith('SEQRES')) continue;
    const chainId = line[11];
    if (!chainId || chainId === ' ') continue;
    const residues = line.substring(19).trim().split(/\s+/).filter(Boolean);
    if (!seqres[chainId]) seqres[chainId] = [];
    seqres[chainId].push(...residues);
  }

  const chains = [];
  for (const [chainId, residues] of Object.entries(seqres)) {
    const type = _detectResidueType(residues);
    const sequence = _convertResidues(residues, type);
    if (type !== 'unknown' && sequence.length > 0) {
      chains.push({ chainId, type, sequence, entityName: `Chain ${chainId}` });
    }
  }
  return chains;
}

function _detectResidueType(residues) {
  if (!residues.length) return 'unknown';
  const upper = residues.map(r => r.toUpperCase());
  const aaCount   = upper.filter(r => AA3TO1[r]).length;
  if (aaCount >= upper.length * 0.6) return 'protein';

  const dnaNucs = new Set(['DA','DC','DG','DT','DU']);
  const rnaNucs = new Set(['A','C','G','U','URI','RU','RA','RC','RG','RU']);
  const hasDNA  = upper.some(r => dnaNucs.has(r) || r === 'T' || r === 'THY');
  const hasRNA  = upper.some(r => r === 'U' || r === 'URI' || r === 'URA');
  const nuclCount = upper.filter(r =>
    dnaNucs.has(r) || rnaNucs.has(r) || ['A','C','G','T','U'].includes(r)
  ).length;
  if (nuclCount >= upper.length * 0.6) {
    return (hasDNA && !hasRNA) ? 'dna' : 'rna';
  }
  return 'unknown';
}

function _convertResidues(residues, type) {
  if (type === 'protein') {
    return residues.map(r => AA3TO1[r.toUpperCase()] || 'X').join('');
  }
  if (type === 'rna' || type === 'dna') {
    return residues.map(r => {
      const u = r.toUpperCase();
      if (['DA','RA','A','ADE'].includes(u)) return 'A';
      if (['DC','RC','C','CYT'].includes(u)) return 'C';
      if (['DG','RG','G','GUA'].includes(u)) return 'G';
      if (['DU','RU','U','URA','URI','UR'].includes(u)) return 'U';
      if (['DT','T','THY'].includes(u)) return 'T';
      return 'N';
    }).join('');
  }
  return '';
}

// ─── mmCIF parser ─────────────────────────────────────────────────────────────

function parseMmCIF(text) {
  const entities   = _mmcifParseEntities(text);    // entityId → {type, sequence, description}
  const asyms      = _mmcifParseAsyms(text);        // asymId   → entityId
  const nonpolys   = _mmcifParseNonpolys(text);     // entityId → compId

  const chains = [];

  // Polymers → sequence chains
  for (const [asymId, entityId] of Object.entries(asyms)) {
    const ent = entities[entityId];
    if (!ent || ent.type === 'water') continue;
    if (ent.type === 'non-polymer' || ent.type === 'branched') {
      const ccdCode = nonpolys[entityId];
      if (ccdCode) {
        chains.push({
          chainId: asymId,
          type: 'ligand',
          sequence: '',
          ccdCode,
          entityName: ent.description || ccdCode,
        });
      }
      continue;
    }
    // polymer
    const seqType = _mmcifPolyType(ent.polymerType);
    if (seqType === 'unknown' || !ent.sequence) continue;
    const seq = ent.sequence.replace(/[^A-Za-z]/g, '').toUpperCase();
    chains.push({
      chainId: asymId,
      type: seqType,
      sequence: seq,
      entityName: ent.description || `Chain ${asymId}`,
    });
  }

  return chains;
}

function _mmcifPolyType(polymerType) {
  if (!polymerType) return 'unknown';
  const t = polymerType.toLowerCase();
  if (t.includes('polypeptide')) return 'protein';
  if (t.includes('polyribonucleotide') || t.includes('rna')) return 'rna';
  if (t.includes('polydeoxyribonucleotide') || t.includes('dna')) return 'dna';
  return 'unknown';
}

// Parse _entity loop
function _mmcifParseEntities(text) {
  const entities = {};

  // Try loop_ form first
  const loopMatch = _mmcifFindLoop(text, '_entity.id');
  if (loopMatch) {
    const cols = loopMatch.columns;
    const iId   = cols.indexOf('_entity.id');
    const iType = cols.indexOf('_entity.type');
    const iDesc = cols.indexOf('_entity.pdbx_description');
    for (const row of loopMatch.rows) {
      const id   = row[iId];
      const type = iType >= 0 ? row[iType] : '';
      const desc = iDesc >= 0 ? row[iDesc] : '';
      if (id) entities[id] = { type: type.toLowerCase(), description: _mmcifUnquote(desc) };
    }
  }

  // Parse _entity_poly for polymer type and sequence
  const polyLoop = _mmcifFindLoop(text, '_entity_poly.entity_id');
  if (polyLoop) {
    const cols   = polyLoop.columns;
    const iEid   = cols.indexOf('_entity_poly.entity_id');
    const iPtype = cols.indexOf('_entity_poly.type');
    const iSeq   = cols.indexOf('_entity_poly.pdbx_seq_one_letter_code_can');
    const iSeq2  = cols.indexOf('_entity_poly.pdbx_seq_one_letter_code');
    for (const row of polyLoop.rows) {
      const eid   = row[iEid];
      const ptype = iPtype >= 0 ? row[iPtype] : '';
      const seqIdx = iSeq >= 0 ? iSeq : iSeq2;
      const seq   = seqIdx >= 0 ? _mmcifUnquote(row[seqIdx]) : '';
      if (!eid) continue;
      if (!entities[eid]) entities[eid] = { type: 'polymer' };
      entities[eid].polymerType = _mmcifUnquote(ptype);
      entities[eid].sequence    = seq.replace(/\n/g, '').replace(/;/g, '');
    }
  }

  // Handle multi-line sequence values (semicolon-delimited text fields in CIF)
  // The loop parser may not handle multi-line; do a targeted regex search
  const seqRe = /_entity_poly\.pdbx_seq_one_letter_code(?:_can)?\s*\n;([\s\S]*?);/gm;
  // Not needed because _mmcifFindLoop handles it; kept as fallback if needed

  return entities;
}

// Parse _struct_asym to get chain→entity mapping
function _mmcifParseAsyms(text) {
  const asyms = {};
  const loop = _mmcifFindLoop(text, '_struct_asym.id');
  if (!loop) return asyms;
  const cols  = loop.columns;
  const iId   = cols.indexOf('_struct_asym.id');
  const iEid  = cols.indexOf('_struct_asym.entity_id');
  for (const row of loop.rows) {
    const id  = row[iId];
    const eid = row[iEid];
    if (id && eid) asyms[id] = eid;
  }
  return asyms;
}

// Parse _pdbx_entity_nonpoly for ligand CCD codes
function _mmcifParseNonpolys(text) {
  const nonpolys = {};
  const loop = _mmcifFindLoop(text, '_pdbx_entity_nonpoly.entity_id');
  if (!loop) return nonpolys;
  const cols  = loop.columns;
  const iEid  = cols.indexOf('_pdbx_entity_nonpoly.entity_id');
  const iComp = cols.indexOf('_pdbx_entity_nonpoly.comp_id');
  for (const row of loop.rows) {
    const eid  = row[iEid];
    const comp = row[iComp];
    if (eid && comp) nonpolys[eid] = comp;
  }
  return nonpolys;
}

// Minimal CIF loop parser: finds a loop that has the given column, returns {columns, rows}
function _mmcifFindLoop(text, targetColumn) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === 'loop_') {
      i++;
      const columns = [];
      // Collect column names
      while (i < lines.length && lines[i].trim().startsWith('_')) {
        columns.push(lines[i].trim());
        i++;
      }
      if (!columns.includes(targetColumn)) {
        // Not the loop we want; skip rows until next loop_ or new category
        while (i < lines.length) {
          const l = lines[i].trim();
          if (l === 'loop_' || (l.startsWith('_') && !l.includes(' ')) || l.startsWith('data_')) break;
          i++;
        }
        continue;
      }
      // Collect rows
      const rows = [];
      const nCols = columns.length;
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!l || l.startsWith('#')) { i++; continue; }
        if (l === 'loop_' || l.startsWith('data_')) break;
        if (l.startsWith('_') && !l.includes(' ')) break;
        // Handle semicolon multi-line text fields
        if (l.startsWith(';')) {
          let value = '';
          i++;
          while (i < lines.length && !lines[i].startsWith(';')) {
            value += lines[i] + '\n';
            i++;
          }
          i++; // skip closing ;
          if (rows.length > 0) {
            const row = rows[rows.length - 1];
            if (row.length < nCols) row.push(value.trim());
          }
          continue;
        }
        // Tokenize row
        const tokens = _mmcifTokenize(l);
        // Accumulate tokens until we have a full row
        let pending = rows.length > 0 && rows[rows.length - 1].length < nCols
          ? rows[rows.length - 1] : null;
        if (!pending) { rows.push([]); pending = rows[rows.length - 1]; }
        for (const tok of tokens) {
          pending.push(tok);
          if (pending.length === nCols) {
            rows.push([]);
            pending = rows[rows.length - 1];
          }
        }
        i++;
      }
      // Remove last empty row if any
      if (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      return { columns, rows };
    }
    i++;
  }
  return null;
}

function _mmcifTokenize(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      let val = '';
      while (i < line.length && line[i] !== q) val += line[i++];
      i++;
      tokens.push(val);
    } else {
      let val = '';
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') val += line[i++];
      tokens.push(val);
    }
  }
  return tokens;
}

function _mmcifUnquote(s) {
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s === '.' || s === '?' ? '' : s;
}

// ─── Import modal ─────────────────────────────────────────────────────────────

let _pdbChains  = [];
let _onPdbImport = null;

/**
 * Open the PDB/mmCIF import modal with the given chain list.
 * onImport(chains) is called with selected chain objects.
 */
export function openPdbModal(text, onImport) {
  _onPdbImport = onImport;
  const fmt    = _detectFileFormat(text);
  _pdbChains   = fmt === 'mmcif' ? parseMmCIF(text) : parsePDB(text);

  if (!_pdbChains.length) {
    alert('No chains found in the file. Make sure it is a valid PDB or mmCIF file.');
    return;
  }

  _renderPdbModal(_pdbChains);
  document.getElementById('pdb-modal').style.display = 'flex';
}

function _renderPdbModal(chains) {
  const list = document.getElementById('pdbChainList');
  list.innerHTML = '';

  const typeCounts = { protein: 0, rna: 0, dna: 0, ligand: 0 };
  chains.forEach(c => { if (typeCounts[c.type] !== undefined) typeCounts[c.type]++; });

  const summary = document.getElementById('pdbSummary');
  const parts = [];
  if (typeCounts.protein) parts.push(`${typeCounts.protein} protein chain${typeCounts.protein>1?'s':''}`);
  if (typeCounts.rna)     parts.push(`${typeCounts.rna} RNA`);
  if (typeCounts.dna)     parts.push(`${typeCounts.dna} DNA`);
  if (typeCounts.ligand)  parts.push(`${typeCounts.ligand} ligand${typeCounts.ligand>1?'s':''}`);
  summary.textContent = parts.join(', ') || 'No recognizable chains';

  chains.forEach((chain, i) => {
    const row = document.createElement('div');
    row.className = 'pdb-chain-row';

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.id      = `pdbCb_${i}`;
    cb.checked = chain.type !== 'ligand'; // include proteins/RNA/DNA by default, not ligands

    const typeBadge = `<span class="pdb-type-badge pdb-type-${chain.type}">${chain.type}</span>`;
    const seqPreview = chain.sequence
      ? `<span class="pdb-seq-preview">${chain.sequence.slice(0, 30)}${chain.sequence.length > 30 ? '…' : ''}</span> <span class="pdb-seq-len">${chain.sequence.length} ${chain.type === 'dna' || chain.type === 'rna' ? 'nt' : 'aa'}</span>`
      : (chain.ccdCode ? `<span class="pdb-seq-preview">${chain.ccdCode}</span>` : '');

    row.innerHTML = `
      <input type="checkbox" class="pdb-chain-cb" id="pdbCb_${i}" data-idx="${i}" ${cb.checked ? 'checked' : ''}>
      <label for="pdbCb_${i}" class="pdb-chain-label">
        <span class="pdb-chain-id">Chain ${chain.chainId}</span>
        ${typeBadge}
        <span class="pdb-entity-name">${chain.entityName || ''}</span>
        ${seqPreview}
      </label>`;

    list.appendChild(row);
  });
}

export function initPdbModal() {
  document.getElementById('pdbModalClose').onclick   = _closePdbModal;
  document.getElementById('pdbImportCancel').onclick = _closePdbModal;
  document.getElementById('pdbImportConfirm').onclick = _confirmPdbImport;
}

function _closePdbModal() {
  document.getElementById('pdb-modal').style.display = 'none';
  _pdbChains   = [];
  _onPdbImport = null;
}

function _confirmPdbImport() {
  const selected = [];
  document.querySelectorAll('.pdb-chain-cb:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (_pdbChains[idx]) selected.push(_pdbChains[idx]);
  });

  if (!selected.length) {
    alert('No chains selected.');
    return;
  }

  if (_onPdbImport) _onPdbImport(selected);
  _closePdbModal();
}
