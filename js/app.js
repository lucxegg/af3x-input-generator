/**
 * AF3x Input Generator — main application
 *
 * Manages the form state, sequence cards, crosslink groups, disulfide bonds,
 * PTM picker, JSON generation, JSON import, and coordinates the arc diagram.
 */

import { CROSSLINKERS, PTM_DATABASE, PTM_CATEGORIES, CHAIN_COLORS, XL_GROUP_COLORS } from './data.js';
import { drawArcDiagram } from './viz.js';
import { openImportModal, initImportModal, _shortProteinName } from './csv_import.js';
import { openPdbModal, initPdbModal } from './pdb_import.js';
import { updateXlStats } from './xl_stats.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _seqCounter = 0;   // unique id for each sequence entity
let _xlCounter  = 0;   // unique id for each crosslink group
let _ssCounter  = 0;   // unique id for each disulfide bond
let _bondCounter = 0;  // unique id for each bonded atom pair

// active PTM picker context
let _ptmContext = null;  // { seqId, modIdx }

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _initCrosslinkPresets();
  _initPTMModal();
  _initJsonImport();
  initImportModal();
  initPdbModal();

  // Add-entity buttons
  document.querySelectorAll('.btn-add-entity').forEach(btn => {
    btn.addEventListener('click', () => addSequenceCard(btn.dataset.seqtype));
  });

  // Crosslinks section
  document.getElementById('addCrosslinkGroupBtn').addEventListener('click', addCrosslinkGroup);
  document.getElementById('crosslinkerPresetsBtn').addEventListener('click', _togglePresetsDropdown);

  // Disulfide bonds
  document.getElementById('addSsBondBtn').addEventListener('click', addSsBond);

  // Bonded atom pairs
  document.getElementById('addBondBtn').addEventListener('click', addBond);

  // Generate + copy + download
  document.getElementById('generateBtn').addEventListener('click', generateJSON);
  document.getElementById('copyJsonBtn').addEventListener('click', _copyJSON);

  // Batch export
  document.getElementById('batchSingleBtn').addEventListener('click', _batchSingleXL);
  document.getElementById('batchComboBtn').addEventListener('click', _batchRandomCombos);
  document.getElementById('batchComboK').addEventListener('input', _updateBatchInfo);
  document.getElementById('batchComboM').addEventListener('input', _updateBatchInfo);
  document.getElementById('batchPanel').addEventListener('toggle', _updateBatchInfo);

  // JSON import button
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', _handleJsonImport);

  // CSV import button (from crosslinks section)
  document.getElementById('importCsvBtn').addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', _handleCsvFile);

  // PDB / mmCIF import
  document.getElementById('importPdbBtn').addEventListener('click', () => {
    document.getElementById('pdbFileInput').click();
  });
  document.getElementById('pdbFileInput').addEventListener('change', _handlePdbFile);

  // localStorage restore banner
  _checkRestoreSession();

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    const dd = document.getElementById('presets-dropdown');
    if (!dd.contains(e.target) && e.target.id !== 'crosslinkerPresetsBtn') {
      dd.style.display = 'none';
    }
  });

  // Start with one protein sequence
  addSequenceCard('protein');
});

// ─── Sequence Cards ───────────────────────────────────────────────────────────

export function addSequenceCard(type) {
  _seqCounter++;
  const id       = `seq_${_seqCounter}`;
  const colorIdx = (_seqCounter - 1) % CHAIN_COLORS.length;
  const color    = CHAIN_COLORS[colorIdx];

  const card = document.createElement('div');
  card.className  = 'seq-card';
  card.dataset.id = id;
  card.dataset.colorIdx = colorIdx;
  card.style.setProperty('--chain-color', color);

  card.innerHTML = `
    <div class="seq-card-main">

      <div class="seq-left">
        <span class="drag-handle">⠿</span>
        <span class="seq-type-badge" style="background:${color}">${_typeLabel(type)}</span>
        <span class="seq-type-label">${_typeLabel(type)}</span>
        <div class="seq-chain-id-wrap">
          <label>Chain ID(s)</label>
          <input type="text" class="seq-chain-id" placeholder="A" value="${_nextChainId()}"
                 autocomplete="off" spellcheck="false" data-seqid="${id}">
          <span class="chain-id-dup-warn" style="display:none" title="Duplicate chain ID">⚠</span>
        </div>
      </div>

      <div class="seq-right">
        ${_sequenceInputBlock(type, id)}
      </div>

      <div class="seq-actions">
        <button class="btn-icon btn-remove-seq" data-seqid="${id}" title="Remove">✕</button>
      </div>

    </div>

    <details class="seq-advanced">
      <summary>Advanced options</summary>
      ${_advancedBlock(type, id)}
    </details>
  `;

  // Wire input mode tabs and interactive elements
  _wireSeqInputTabs(card, type, id);

  card.querySelector('.btn-remove-seq').addEventListener('click', () => {
    card.remove();
    _updateSeqCount();
    updateViz();
  });

  card.querySelector('.seq-chain-id').addEventListener('input', updateViz);

  document.getElementById('sequences-container').appendChild(card);
  _updateSeqCount();
  updateViz();
}

function _typeLabel(type) {
  return { protein: 'Protein', rna: 'RNA', dna: 'DNA', ligand: 'Ligand' }[type] || type;
}

function _nextChainId() {
  const used = new Set();
  document.querySelectorAll('.seq-chain-id').forEach(el => {
    el.value.split(',').map(s => s.trim()).forEach(c => used.add(c));
  });
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  return 'A';
}

function _updateSeqCount() {
  const n = document.querySelectorAll('.seq-card').length;
  document.getElementById('seqCountBadge').textContent = n;
}

function _sequenceInputBlock(type, id) {
  if (type === 'ligand') {
    return `
      <div class="seq-body ligand-body">
        <div class="input-tabs">
          <button class="tab-btn active" data-tab="ccd">CCD Codes</button>
          <button class="tab-btn" data-tab="smiles">SMILES</button>
        </div>
        <div class="tab-panel active" data-panel="ccd">
          <input type="text" class="ligand-ccd seq-validated" placeholder="e.g. ATP or ATP,ADP"
                 data-seqid="${id}" autocomplete="off">
          <span class="seq-hint">Comma-separated CCD codes from the wwPDB Chemical Component Dictionary</span>
        </div>
        <div class="tab-panel" data-panel="smiles" style="display:none">
          <input type="text" class="ligand-smiles seq-validated"
                 placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" data-seqid="${id}" autocomplete="off">
          <span class="seq-hint">SMILES string (cannot define covalent bonds with SMILES)</span>
        </div>
      </div>`;
  }

  const placeholder = type === 'protein'
    ? 'MKVLWAALLVTFLAGCQAKVEQAVEDANSQATRVCEKMFEASYSRVEDVYASPKLQNLFKDPQYILINTTESYTLDADMKIAQEKKTSFQKLTENFQKLENFMLNKFKKNLKDTFEALKNVSKLKL'
    : type === 'rna' ? 'AGCUAGCUAGCU' : 'ACGTACGTACGT';

  return `
    <div class="seq-body">
      <div class="input-tabs">
        <button class="tab-btn active" data-tab="text">Sequence</button>
        <button class="tab-btn" data-tab="fasta">FASTA</button>
        <button class="tab-btn" data-tab="file">Upload</button>
        ${type === 'protein' ? '<button class="tab-btn" data-tab="uniprot">UniProt ID</button>' : ''}
      </div>

      <div class="tab-panel active" data-panel="text">
        <div class="seq-editor-wrap">
          <pre class="seq-ruler" aria-hidden="true"></pre>
          <textarea class="seq-textarea seq-validated"
                    placeholder="${placeholder}"
                    data-seqid="${id}" spellcheck="false"></textarea>
        </div>
        <div class="seq-meta"><span class="seq-length-hint"></span><span class="seq-val-msg"></span></div>
      </div>

      <div class="tab-panel" data-panel="fasta" style="display:none">
        <textarea class="fasta-input" rows="4"
                  placeholder=">My protein\nMKVLWAALL..."
                  data-seqid="${id}" spellcheck="false"></textarea>
        <button class="btn btn-outline btn-sm parse-fasta-btn" data-seqid="${id}">Parse FASTA</button>
      </div>

      <div class="tab-panel" data-panel="file" style="display:none">
        <div class="file-drop-zone" data-seqid="${id}">
          <span>Drag & drop a FASTA file, or <label class="file-browse-label">browse<input type="file" class="fasta-file-input" accept=".fasta,.fa,.txt" data-seqid="${id}"></label></span>
        </div>
      </div>

      ${type === 'protein' ? `
      <div class="tab-panel" data-panel="uniprot" style="display:none">
        <div class="uniprot-row">
          <input type="text" class="uniprot-input" placeholder="e.g. P04637 or Q9Y6K9"
                 data-seqid="${id}" autocomplete="off">
          <button class="btn btn-outline btn-sm fetch-uniprot-btn" data-seqid="${id}">Fetch</button>
        </div>
        <div class="uniprot-status" data-seqid="${id}"></div>
      </div>` : ''}
    </div>`;
}

function _advancedBlock(type, id) {
  if (type === 'ligand') return '<p class="adv-hint">No advanced options for ligands.</p>';

  const modSection = `
    <div class="adv-section">
      <div class="adv-section-header">
        <span>Modifications</span>
        <button class="btn btn-outline btn-xs add-mod-btn" data-seqid="${id}">+ Add</button>
      </div>
      <div class="mods-container" data-seqid="${id}"></div>
    </div>`;

  // DNA has no MSA support per AF3x spec
  const msaSection = type === 'dna' ? '' : `
    <div class="adv-section">
      <div class="adv-section-header">
        <span>MSA</span>
        <select class="msa-mode-sel" data-seqid="${id}">
          <option value="auto">Auto (AF3 generates)</option>
          <option value="custom">Custom .a3m files</option>
          <option value="none">None (MSA-free)</option>
        </select>
      </div>
      <div class="msa-custom-wrap" data-seqid="${id}" style="display:none">
        <div class="msa-file-row">
          <span class="msa-file-label">Unpaired</span>
          <input type="text" class="msa-unpaired-path"
                 placeholder="/path/to/MSAs_A_unpaired.a3m" data-seqid="${id}">
          <label class="btn btn-ghost btn-xs msa-upload-label" title="Upload .a3m file — content is embedded inline in JSON">
            Upload <input type="file" class="msa-unpaired-file" accept=".a3m,.txt" data-seqid="${id}" style="display:none">
          </label>
          <textarea class="msa-unpaired-content" style="display:none" data-seqid="${id}"></textarea>
        </div>
        ${type === 'protein' ? `
        <div class="msa-file-row">
          <span class="msa-file-label">Paired</span>
          <input type="text" class="msa-paired-path"
                 placeholder="/path/to/MSAs_A_paired.a3m" data-seqid="${id}">
          <label class="btn btn-ghost btn-xs msa-upload-label" title="Upload .a3m file — content is embedded inline in JSON">
            Upload <input type="file" class="msa-paired-file" accept=".a3m,.txt" data-seqid="${id}" style="display:none">
          </label>
          <textarea class="msa-paired-content" style="display:none" data-seqid="${id}"></textarea>
        </div>` : ''}
        <p class="adv-hint msa-path-hint">Enter a file path for cluster use
          (<code>unpairedMsaPath</code>), or upload a local .a3m file
          (embedded inline as <code>unpairedMsa</code>). Path takes priority over upload.</p>
      </div>
    </div>`;

  const tplSection = type === 'protein' ? `
    <div class="adv-section">
      <div class="adv-section-header">
        <span>Structural Templates</span>
        <button class="btn btn-outline btn-xs add-tpl-btn" data-seqid="${id}">+ Add template</button>
      </div>
      <p class="adv-hint">If no templates are added, AF3 searches automatically. Add at least one to override (empty list → template-free).</p>
      <div class="tpl-container" data-seqid="${id}"></div>
    </div>` : '';

  return modSection + msaSection + tplSection;
}

// ── Tab wiring (input modes) ──────────────────────────────────────────────────

function _wireSeqInputTabs(card, type, id) {
  const tabs   = card.querySelectorAll('.input-tabs .tab-btn');
  const panels = card.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
      tab.classList.add('active');
      const panel = card.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
    });
  });

  // Sequence textarea: auto-uppercase + ruler + scroll sync
  const seqTA = card.querySelector('.seq-textarea');
  if (seqTA) {
    let _upperTimer = null;

    seqTA.addEventListener('input', () => {
      _updateRuler(card);
      _autoValidateSeq(seqTA, type);
      updateViz();

      // Auto-uppercase after 1.5 s of no typing
      clearTimeout(_upperTimer);
      _upperTimer = setTimeout(() => {
        const upper = seqTA.value.toUpperCase();
        if (seqTA.value !== upper) {
          const pos = seqTA.selectionStart;
          seqTA.value = upper;
          seqTA.setSelectionRange(pos, pos);
          _autoValidateSeq(seqTA, type);
          _updateRuler(card);
        }
      }, 1500);
    });

    // Sync ruler scroll with textarea horizontal scroll
    seqTA.addEventListener('scroll', () => {
      const ruler = card.querySelector('.seq-ruler');
      if (ruler) ruler.scrollLeft = seqTA.scrollLeft;
    });
  }

  // Ligand CCD/SMILES tabs
  if (type === 'ligand') {
    const ltabs = card.querySelectorAll('.ligand-body .tab-btn');
    const lpanels = card.querySelectorAll('.ligand-body .tab-panel');
    ltabs.forEach(tab => {
      tab.addEventListener('click', () => {
        ltabs.forEach(t => t.classList.remove('active'));
        lpanels.forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
        tab.classList.add('active');
        const panel = card.querySelector(`.ligand-body .tab-panel[data-panel="${tab.dataset.tab}"]`);
        if (panel) { panel.style.display = 'block'; }
      });
    });
    return;
  }

  // FASTA parse button
  const parseFastaBtn = card.querySelector('.parse-fasta-btn');
  if (parseFastaBtn) {
    parseFastaBtn.addEventListener('click', () => {
      const ta = card.querySelector('.fasta-input');
      const seq = _extractFasta(ta.value);
      if (seq) _setSeqAndSwitchToText(card, seq, type);
      else alert('No valid FASTA sequence found.');
    });
  }

  // File drop / upload
  const fileInput = card.querySelector('.fasta-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const seq = _extractFasta(e.target.result);
        if (seq) _setSeqAndSwitchToText(card, seq, type);
        else alert('No valid FASTA sequence found in file.');
      };
      reader.readAsText(file);
    });
  }

  // Drag-and-drop
  const dropZone = card.querySelector('.file-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const seq = _extractFasta(ev.target.result);
        if (seq) _setSeqAndSwitchToText(card, seq, type);
      };
      reader.readAsText(file);
    });
  }

  // UniProt fetch
  const fetchBtn = card.querySelector('.fetch-uniprot-btn');
  if (fetchBtn) {
    fetchBtn.addEventListener('click', () => _fetchUniProt(card, type, id));
    const uniInput = card.querySelector('.uniprot-input');
    if (uniInput) {
      uniInput.addEventListener('keydown', e => { if (e.key === 'Enter') _fetchUniProt(card, type, id); });
    }
  }

  // Modification button
  const addModBtn = card.querySelector('.add-mod-btn');
  if (addModBtn) {
    addModBtn.addEventListener('click', () => {
      _openPTMPicker(id, null);
    });
  }

  // Template button
  const addTplBtn = card.querySelector('.add-tpl-btn');
  if (addTplBtn) {
    addTplBtn.addEventListener('click', () => _addTemplate(card, id));
  }

  // MSA mode selector
  const msaModeEl = card.querySelector('.msa-mode-sel');
  if (msaModeEl) {
    const customWrap = card.querySelector(`.msa-custom-wrap[data-seqid="${id}"]`);
    msaModeEl.addEventListener('change', () => {
      if (customWrap) customWrap.style.display = msaModeEl.value === 'custom' ? 'block' : 'none';
    });

    // File upload: unpaired
    const unpairedFile = card.querySelector('.msa-unpaired-file');
    if (unpairedFile) {
      unpairedFile.addEventListener('change', () => {
        const file = unpairedFile.files[0];
        if (!file) return;
        const pathInput   = card.querySelector('.msa-unpaired-path');
        const contentArea = card.querySelector('.msa-unpaired-content');
        const reader = new FileReader();
        reader.onload = e => {
          if (pathInput)   { pathInput.value = file.name; pathInput.dataset.isUpload = 'true'; }
          if (contentArea) contentArea.value = e.target.result;
        };
        reader.readAsText(file);
      });
    }

    // File upload: paired
    const pairedFile = card.querySelector('.msa-paired-file');
    if (pairedFile) {
      pairedFile.addEventListener('change', () => {
        const file = pairedFile.files[0];
        if (!file) return;
        const pathInput   = card.querySelector('.msa-paired-path');
        const contentArea = card.querySelector('.msa-paired-content');
        const reader = new FileReader();
        reader.onload = e => {
          if (pathInput)   { pathInput.value = file.name; pathInput.dataset.isUpload = 'true'; }
          if (contentArea) contentArea.value = e.target.result;
        };
        reader.readAsText(file);
      });
    }

    // Clear isUpload flag when user manually edits the path
    card.querySelectorAll('.msa-unpaired-path, .msa-paired-path').forEach(inp => {
      inp.addEventListener('input', () => { delete inp.dataset.isUpload; });
    });
  }
}

// ── Sequence helpers ──────────────────────────────────────────────────────────

function _extractFasta(text) {
  const lines = text.split('\n');
  let seq = '';
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('>') || l.startsWith(';')) continue;
    seq += l.toUpperCase();
  }
  return seq || null;
}

function _setSeqAndSwitchToText(card, seq, type) {
  const ta = card.querySelector('.seq-textarea');
  if (ta) {
    ta.value = seq;
    _autoValidateSeq(ta, type);
    _updateRuler(card);
    updateViz();
  }
  // Switch to text tab
  const textTab = card.querySelector('.tab-btn[data-tab="text"]');
  if (textTab) textTab.click();
}

async function _fetchUniProt(card, type, id) {
  const input  = card.querySelector('.uniprot-input');
  const status = card.querySelector('.uniprot-status');
  const uniId  = input.value.trim();
  if (!uniId) return;

  status.textContent = 'Fetching…';
  status.className   = 'uniprot-status loading';

  try {
    const url = `https://rest.uniprot.org/uniprotkb/${uniId}.fasta`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`UniProt returned ${res.status}`);
    const text = await res.text();
    const seq  = _extractFasta(text);
    if (!seq) throw new Error('No sequence in response');
    _setSeqAndSwitchToText(card, seq, type);
    // Also update chain-id placeholder with accession
    status.textContent = `✓ ${uniId} — ${seq.length} residues`;
    status.className   = 'uniprot-status ok';
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    status.className   = 'uniprot-status error';
  }
}

const VALID_AA  = new Set('ACDEFGHIKLMNPQRSTVWY');
const VALID_RNA = new Set('AGCU');
const VALID_DNA = new Set('ACGT');

function _autoValidateSeq(ta, type) {
  const seq = ta.value.toUpperCase().replace(/\s/g, '');
  const card = ta.closest('.seq-card');
  const lenHint = card?.querySelector('.seq-length-hint');
  const valMsg  = card?.querySelector('.seq-val-msg');

  if (!seq) {
    ta.classList.remove('valid', 'invalid');
    if (lenHint) lenHint.textContent = '';
    if (valMsg)  valMsg.textContent  = '';
    return;
  }

  const allowed = type === 'protein' ? VALID_AA : type === 'rna' ? VALID_RNA : VALID_DNA;
  const invalid = [...seq].filter(c => !allowed.has(c));

  if (lenHint) lenHint.textContent = `${seq.length} residues`;

  if (invalid.length) {
    ta.classList.remove('valid');
    ta.classList.add('invalid');
    const sample = [...new Set(invalid)].slice(0, 5).join(', ');
    if (valMsg) valMsg.textContent = `⚠ Unknown characters: ${sample}`;
  } else {
    ta.classList.remove('invalid');
    ta.classList.add('valid');
    if (valMsg) valMsg.textContent = '';
  }
}

// ── Sequence ruler ────────────────────────────────────────────────────────────

function _updateRuler(card) {
  const seqTA = card.querySelector('.seq-textarea');
  const ruler = card.querySelector('.seq-ruler');
  if (!seqTA || !ruler) return;
  const len = seqTA.value.replace(/[\s\r\n]/g, '').length;
  ruler.textContent = len > 0 ? _generateRuler(len) : '';
}

function _generateRuler(seqLen) {
  const arr = Array(seqLen).fill(' ');
  for (let i = 10; i <= seqLen; i += 10) {
    const s = String(i);
    const start = i - s.length; // right-align so last digit sits at position i
    for (let j = 0; j < s.length; j++) arr[start + j] = s[j];
  }
  return arr.join('');
}

// ── Template helper ───────────────────────────────────────────────────────────

function _addTemplate(card, seqId) {
  const container = card.querySelector(`.tpl-container[data-seqid="${seqId}"]`);
  const idx = container.querySelectorAll('.tpl-entry').length;

  const div = document.createElement('div');
  div.className = 'tpl-entry subsection';
  div.innerHTML = `
    <div class="field-row">
      <div class="field field-grow">
        <label>mmCIF content</label>
        <textarea class="tpl-mmcif" rows="2" placeholder="Paste mmCIF or leave blank to use path"></textarea>
      </div>
      <div class="field field-grow">
        <label>mmCIF path</label>
        <input type="text" class="tpl-mmcif-path" placeholder="/path/to/template.cif">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Query indices (0-based, comma-separated)</label>
        <input type="text" class="tpl-query-idx" placeholder="0,1,2,5">
      </div>
      <div class="field">
        <label>Template indices (0-based, comma-separated)</label>
        <input type="text" class="tpl-tpl-idx" placeholder="0,1,2,8">
      </div>
    </div>
    <button class="btn btn-danger btn-xs remove-tpl-btn">Remove template</button>`;

  div.querySelector('.remove-tpl-btn').addEventListener('click', () => div.remove());
  container.appendChild(div);
}

// ─── Crosslink Groups ─────────────────────────────────────────────────────────

export function addCrosslinkGroup(preset = null) {
  _xlCounter++;
  const id    = `xl_${_xlCounter}`;
  const color = XL_GROUP_COLORS[(_xlCounter - 1) % XL_GROUP_COLORS.length];

  const card = document.createElement('div');
  card.className  = 'xl-group-card';
  card.dataset.id = id;
  card.style.setProperty('--xl-color', color);

  const defaultName = preset ? preset.name : 'DSSO';

  card.innerHTML = `
    <div class="xl-group-header">
      <div class="xl-color-dot" style="background:${color}"></div>
      <div class="field field-grow">
        <label>Crosslinker</label>
        ${_crosslinkerSelect(id, defaultName)}
      </div>
      <button class="btn-icon btn-remove-xl" data-xlid="${id}" title="Remove group">✕</button>
    </div>

    <div class="xl-asym-warning" data-xlid="${id}" style="display:none"></div>

    <div class="xl-dynamic-n" data-xlid="${id}" style="display:none">
      <label>n (chain length) <input type="number" class="xl-dyn-n-input" value="5" min="1" max="30"></label>
    </div>

    <div class="xl-pairs-container" data-xlid="${id}"></div>

    <div class="xl-pair-actions">
      <button class="btn btn-outline btn-sm add-pair-btn" data-xlid="${id}">+ Add pair</button>
    </div>`;

  card.querySelector('.btn-remove-xl').addEventListener('click', () => {
    card.remove();
    updateViz();
  });

  card.querySelector('.add-pair-btn').addEventListener('click', () => {
    _addXlPair(card, id);
  });

  const xlSel = card.querySelector('.xl-select');
  xlSel.addEventListener('change', () => _handleXlSelectChange(card, id, xlSel.value));

  document.getElementById('crosslinks-container').appendChild(card);

  // Add one pair by default
  if (preset && preset.pairs) {
    preset.pairs.forEach(p => _addXlPair(card, id, p));
  } else {
    _addXlPair(card, id);
  }

  updateViz();
}

function _crosslinkerSelect(id, defaultValue = 'DSSO') {
  let html = `<select class="xl-select" data-xlid="${id}">`;

  // Group by category
  const categories = [...new Set(CROSSLINKERS.map(x => x.category))];
  categories.forEach(cat => {
    html += `<optgroup label="${cat}">`;
    CROSSLINKERS.filter(x => x.category === cat).forEach(xl => {
      const label = xl.symmetric === false ? `${xl.name} ⚠` : xl.name;
      const sel   = xl.name === defaultValue ? ' selected' : '';
      html += `<option value="${xl.name}"${sel}>${label}</option>`;
    });
    html += '</optgroup>';
  });
  html += '</select>';
  return html;
}

function _handleXlSelectChange(card, id, xlName) {
  const xl     = CROSSLINKERS.find(x => x.name === xlName);
  const warnEl = card.querySelector(`.xl-asym-warning[data-xlid="${id}"]`);
  const dynEl  = card.querySelector(`.xl-dynamic-n[data-xlid="${id}"]`);

  if (xl && !xl.symmetric && !xl.dynamic) {
    warnEl.style.display = 'block';
    warnEl.textContent = `⚠ Asymmetric crosslinker — ${xl.asymmetricNote}`;
  } else {
    warnEl.style.display = 'none';
  }

  if (xl && xl.dynamic) {
    dynEl.style.display = 'block';
  } else {
    dynEl.style.display = 'none';
  }

  updateViz();
}

function _addXlPair(card, xlId, defaults = {}) {
  const container = card.querySelector(`.xl-pairs-container[data-xlid="${xlId}"]`);
  const idx       = container.querySelectorAll('.xl-pair-row').length;

  const row = document.createElement('div');
  row.className = 'xl-pair-row';
  row.innerHTML = `
    <span class="pair-num">${idx + 1}</span>
    <input type="text" class="xl-chain-a" placeholder="Chain" value="${defaults.chain1 || ''}" maxlength="4">
    <input type="number" class="xl-pos-a" placeholder="Res" value="${defaults.pos1 || ''}" min="1">
    <span class="pair-sep">↔</span>
    <input type="text" class="xl-chain-b" placeholder="Chain" value="${defaults.chain2 || ''}" maxlength="4">
    <input type="number" class="xl-pos-b" placeholder="Res" value="${defaults.pos2 || ''}" min="1">
    <span class="xl-pos-warn" style="display:none"></span>
    <button class="btn-icon btn-remove-pair" title="Remove pair">✕</button>`;

  row.querySelector('.btn-remove-pair').addEventListener('click', () => {
    row.remove();
    // Re-number
    container.querySelectorAll('.pair-num').forEach((el, i) => { el.textContent = i + 1; });
    updateViz();
  });

  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateViz));
  wireXlPairRowHover(row);
  container.appendChild(row);
}

// ─── Disulfide Bonds ──────────────────────────────────────────────────────────

function addSsBond() {
  _ssCounter++;
  const id = `ss_${_ssCounter}`;

  const container = document.getElementById('ss-bonds-container');
  const row = document.createElement('div');
  row.className  = 'ss-pair-row';
  row.dataset.id = id;
  row.innerHTML = `
    <span class="pair-label">S–S</span>
    <input type="text" class="ss-chain-a" placeholder="Chain" maxlength="4">
    <input type="number" class="ss-pos-a" placeholder="Cys res" min="1">
    <span class="pair-sep">↔</span>
    <input type="text" class="ss-chain-b" placeholder="Chain" maxlength="4">
    <input type="number" class="ss-pos-b" placeholder="Cys res" min="1">
    <button class="btn-icon btn-remove-pair" title="Remove">✕</button>`;

  row.querySelector('.btn-remove-pair').addEventListener('click', () => {
    row.remove();
    updateViz();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateViz));
  container.appendChild(row);
}

// ─── Bonded Atom Pairs ────────────────────────────────────────────────────────

function addBond() {
  _bondCounter++;
  const id = `bond_${_bondCounter}`;

  const container = document.getElementById('bonds-container');
  const div = document.createElement('div');
  div.className = 'bond-entry subsection';
  div.dataset.id = id;
  div.innerHTML = `
    <div class="bond-atoms">
      <div class="bond-atom-group">
        <span class="atom-label">Atom 1</span>
        <input type="text" class="bond-entity-a" placeholder="Chain ID" maxlength="4">
        <input type="number" class="bond-res-a" placeholder="Res (1-based)" min="1">
        <input type="text" class="bond-atom-a" placeholder="Atom name (e.g. SG)" maxlength="8">
      </div>
      <span class="bond-dash">—</span>
      <div class="bond-atom-group">
        <span class="atom-label">Atom 2</span>
        <input type="text" class="bond-entity-b" placeholder="Chain ID" maxlength="4">
        <input type="number" class="bond-res-b" placeholder="Res (1-based)" min="1">
        <input type="text" class="bond-atom-b" placeholder="Atom name (e.g. C04)" maxlength="8">
      </div>
      <button class="btn btn-danger btn-xs remove-bond-btn">Remove</button>
    </div>`;

  div.querySelector('.remove-bond-btn').addEventListener('click', () => div.remove());
  container.appendChild(div);
}

// ─── PTM Picker ───────────────────────────────────────────────────────────────

function _initPTMModal() {
  const modal    = document.getElementById('ptm-modal');
  const closeBtn = document.getElementById('ptmModalClose');
  const search   = document.getElementById('ptmSearch');
  const tabs     = document.getElementById('ptmCategoryTabs');
  const list     = document.getElementById('ptmList');

  // Build category tabs
  let activeCategory = 'all';
  const allCategories = ['all', ...PTM_CATEGORIES];

  allCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className  = 'cat-tab-btn' + (cat === 'all' ? ' active' : '');
    btn.textContent = cat === 'all' ? 'All' : cat;
    btn.dataset.cat = cat;
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = cat;
      _renderPTMList(list, search.value, activeCategory);
    });
    tabs.appendChild(btn);
  });

  search.addEventListener('input', () => _renderPTMList(list, search.value, activeCategory));
  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
}

function _renderPTMList(list, query, category) {
  const q = query.toLowerCase();
  const filtered = PTM_DATABASE.filter(p => {
    const matchCat  = category === 'all' || p.category === category;
    const matchQ    = !q || p.ccd.toLowerCase().includes(q) ||
                      p.name.toLowerCase().includes(q) ||
                      p.description.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = '<div class="ptm-empty">No modifications match your search.</div>';
    return;
  }

  filtered.forEach(ptm => {
    const item = document.createElement('div');
    item.className  = 'ptm-item';
    item.innerHTML  = `
      <div class="ptm-ccd">${ptm.ccd}</div>
      <div class="ptm-info">
        <span class="ptm-name">${ptm.name}</span>
        <span class="ptm-aa">→ ${ptm.targetAA}</span>
        <span class="ptm-desc">${ptm.description}</span>
      </div>`;
    item.addEventListener('click', () => _applyPTM(ptm));
    list.appendChild(item);
  });
}

function _openPTMPicker(seqId, existingModEl) {
  _ptmContext = { seqId, existingModEl };
  const search = document.getElementById('ptmSearch');
  search.value = '';
  _renderPTMList(document.getElementById('ptmList'), '', 'all');
  document.getElementById('ptm-modal').style.display = 'flex';
  search.focus();
}

function _applyPTM(ptm) {
  if (!_ptmContext) return;
  const { seqId } = _ptmContext;

  const card     = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  const modsEl   = card?.querySelector(`.mods-container[data-seqid="${seqId}"]`);
  if (!modsEl) return;

  _addModRow(modsEl, seqId, ptm.ccd, null);
  document.getElementById('ptm-modal').style.display = 'none';
}

function _addModRow(container, seqId, ccdCode = '', position = '') {
  const row = document.createElement('div');
  row.className = 'mod-row';
  row.innerHTML = `
    <input type="text" class="mod-ccd" value="${ccdCode}" placeholder="CCD code (e.g. SEP)"
           title="Click to pick from database">
    <span class="mod-sep">@</span>
    <input type="number" class="mod-pos" value="${position}" placeholder="Position (1-based)" min="1">
    <button class="btn-icon mod-pick-btn" title="Pick from database">⋯</button>
    <button class="btn-icon btn-remove-pair" title="Remove">✕</button>`;

  row.querySelector('.btn-remove-pair').addEventListener('click', () => row.remove());
  row.querySelector('.mod-pick-btn').addEventListener('click', () => _openPTMPicker(seqId, row));
  container.appendChild(row);
}

// ─── Crosslinker Presets ──────────────────────────────────────────────────────

function _initCrosslinkPresets() {
  const list = document.getElementById('presets-list');
  const presets = CROSSLINKERS.filter(xl => !xl.dynamic).slice(0, 8);

  presets.forEach(xl => {
    const btn = document.createElement('button');
    btn.className   = 'preset-btn';
    btn.innerHTML   = `<strong>${xl.name}</strong><span>${xl.description}</span>`;
    btn.addEventListener('click', () => {
      addCrosslinkGroup({ name: xl.name });
      document.getElementById('presets-dropdown').style.display = 'none';
    });
    list.appendChild(btn);
  });
}

function _togglePresetsDropdown() {
  const dd  = document.getElementById('presets-dropdown');
  const btn = document.getElementById('crosslinkerPresetsBtn');
  if (dd.style.display === 'none') {
    const rect = btn.getBoundingClientRect();
    dd.style.top  = (btn.offsetTop + btn.offsetHeight + 4) + 'px';
    dd.style.display = 'block';
  } else {
    dd.style.display = 'none';
  }
}

// ─── CSV Import handler ───────────────────────────────────────────────────────

function _handleCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    openImportModal(ev.target.result, _onCsvImport, file);
  };
  reader.readAsText(file);
  e.target.value = '';  // reset so same file can be re-selected
}

function _onCsvImport(pairs, xlName, proteinToChain, sequences = {}) {
  // Create sequence cards for proteins with fetched sequences (sorted by chain ID)
  const chainOrder = Object.entries(proteinToChain)
    .filter(([prot]) => sequences[prot])
    .sort((a, b) => a[1].localeCompare(b[1]));

  chainOrder.forEach(([prot, chainId]) => {
    const seq = sequences[prot];

    // Try to reuse an existing card with this chain ID that has no sequence yet
    let targetCard = null;
    document.querySelectorAll('.seq-card').forEach(card => {
      const cid = card.querySelector('.seq-chain-id')?.value.trim();
      const ta  = card.querySelector('.seq-textarea');
      if (cid === chainId && ta && !ta.value.trim()) targetCard = card;
    });

    if (!targetCard) {
      // Check if chain already has content — skip to avoid overwrite
      let hasContent = false;
      document.querySelectorAll('.seq-card').forEach(card => {
        const cid = card.querySelector('.seq-chain-id')?.value.trim();
        const ta  = card.querySelector('.seq-textarea');
        if (cid === chainId && ta && ta.value.trim()) hasContent = true;
      });
      if (hasContent) return;

      addSequenceCard('protein');
      targetCard = document.querySelector('#sequences-container .seq-card:last-child');
      if (targetCard) targetCard.querySelector('.seq-chain-id').value = chainId;
    }

    if (!targetCard) return;
    const ta = targetCard.querySelector('.seq-textarea');
    if (ta) {
      ta.value = seq;
      _autoValidateSeq(ta, 'protein');
      _updateRuler(targetCard);
    }
  });

  // Add crosslink group
  const converted = pairs.map(p => ({
    chain1: proteinToChain[p.protein1] || p.protein1,
    pos1:   p.pos1,
    chain2: proteinToChain[p.protein2] || p.protein2,
    pos2:   p.pos2,
  }));
  addCrosslinkGroup({ name: xlName, pairs: converted });
}

// ─── JSON import ──────────────────────────────────────────────────────────────

function _initJsonImport() {
  // handled via event listener in DOMContentLoaded
}

function _handleJsonImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const json = JSON.parse(ev.target.result);
      _populateFromJSON(json);
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function _populateFromJSON(json) {
  // Clear existing
  document.getElementById('sequences-container').innerHTML = '';
  document.getElementById('crosslinks-container').innerHTML = '';
  document.getElementById('ss-bonds-container').innerHTML = '';
  _seqCounter = 0; _xlCounter = 0; _ssCounter = 0;

  // Job settings
  document.getElementById('jobName').value      = json.name || '';
  document.getElementById('modelSeeds').value   = (json.modelSeeds || [1]).join(',');
  document.getElementById('inputVersion').value = json.version || 1;

  // Sequences
  (json.sequences || []).forEach(seqObj => {
    const type = Object.keys(seqObj)[0];
    const data = seqObj[type];
    addSequenceCard(type);

    const card = document.querySelector('.seq-card:last-child');
    if (!card) return;

    // Chain ID
    const chainInput = card.querySelector('.seq-chain-id');
    if (chainInput) {
      chainInput.value = Array.isArray(data.id) ? data.id.join(',') : (data.id || '');
    }

    // Sequence
    const seqTA = card.querySelector('.seq-textarea');
    if (seqTA && data.sequence) {
      seqTA.value = data.sequence;
      _autoValidateSeq(seqTA, type);
      _updateRuler(card);
    }

    // Ligand
    if (type === 'ligand') {
      if (data.smiles) {
        card.querySelector('.ligand-smiles').value = data.smiles;
        card.querySelector('.tab-btn[data-tab="smiles"]')?.click();
      } else if (data.ccdCodes) {
        card.querySelector('.ligand-ccd').value = data.ccdCodes.join(',');
      }
    }

    // MSA
    const msaModeEl   = card.querySelector('.msa-mode-sel');
    const msaCustomWrap = card.querySelector('.msa-custom-wrap');
    if (msaModeEl) {
      const hasMsaFree   = data.unpairedMsa === '' || data.pairedMsa === '';
      const hasCustomMsa = data.unpairedMsaPath || data.pairedMsaPath || data.unpairedMsa || data.pairedMsa;
      if (hasMsaFree) {
        msaModeEl.value = 'none';
      } else if (hasCustomMsa) {
        msaModeEl.value = 'custom';
        if (msaCustomWrap) msaCustomWrap.style.display = 'block';
        const unpairedPathEl = card.querySelector('.msa-unpaired-path');
        const pairedPathEl   = card.querySelector('.msa-paired-path');
        if (unpairedPathEl) {
          if (data.unpairedMsaPath) {
            unpairedPathEl.value = data.unpairedMsaPath;
          } else if (data.unpairedMsa) {
            const contentEl = card.querySelector('.msa-unpaired-content');
            if (contentEl) contentEl.value = data.unpairedMsa;
            unpairedPathEl.value = '(inline content)';
            unpairedPathEl.dataset.isUpload = 'true';
          }
        }
        if (pairedPathEl) {
          if (data.pairedMsaPath) {
            pairedPathEl.value = data.pairedMsaPath;
          } else if (data.pairedMsa) {
            const contentEl = card.querySelector('.msa-paired-content');
            if (contentEl) contentEl.value = data.pairedMsa;
            pairedPathEl.value = '(inline content)';
            pairedPathEl.dataset.isUpload = 'true';
          }
        }
      }
    }

    // Modifications
    if (data.modifications?.length) {
      const modsEl = card.querySelector('.mods-container');
      data.modifications.forEach(mod => {
        const code = mod.ptmType || mod.modificationType || '';
        const pos  = mod.ptmPosition || mod.basePosition || '';
        if (modsEl) _addModRow(modsEl, card.dataset.id, code, pos);
      });
    }
  });

  // Crosslinks
  (json.crosslinks || []).forEach(group => {
    const pairs = (group.residue_pairs || []).map(pair => ({
      chain1: pair[0][0], pos1: pair[0][1],
      chain2: pair[1][0], pos2: pair[1][1],
    }));
    addCrosslinkGroup({ name: group.name, pairs });
  });

  // Disulfide bonds
  (json.disulfide_bonds || []).forEach(ssBond => {
    (ssBond.residue_pairs || []).forEach(pair => {
      addSsBond();
      const row = document.querySelector('.ss-pair-row:last-child');
      if (row) {
        row.querySelector('.ss-chain-a').value = pair[0][0];
        row.querySelector('.ss-pos-a').value   = pair[0][1];
        row.querySelector('.ss-chain-b').value = pair[1][0];
        row.querySelector('.ss-pos-b').value   = pair[1][1];
      }
    });
  });

  // User CCD
  document.getElementById('userCCD').value     = json.userCCD || '';
  document.getElementById('userCCDPath').value  = json.userCCDPath || '';

  updateViz();
  alert('JSON imported successfully!');
}

// ─── JSON Generation ──────────────────────────────────────────────────────────

function generateJSON() {
  try {
    const output = _buildJSON();
    const pretty = JSON.stringify(output, null, 2);

    const el = document.getElementById('jsonOutput');
    el.textContent = pretty;

    // Show copy + download
    document.getElementById('copyJsonBtn').style.display  = 'inline-block';
    const dl = document.getElementById('downloadJsonLink');
    dl.href     = 'data:application/json;charset=utf-8,' + encodeURIComponent(pretty);
    dl.download = (output.name || 'alphafold3_input') + '.json';
    dl.style.display = 'inline-block';

  } catch (err) {
    document.getElementById('jsonOutput').textContent = '// Error: ' + err.message;
    console.error(err);
  }
}

function _buildJSON() {
  const name    = document.getElementById('jobName').value.trim();
  const seedRaw = document.getElementById('modelSeeds').value;
  const version = parseInt(document.getElementById('inputVersion').value) || 4;

  const seeds = seedRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (!seeds.length) throw new Error('At least one model seed is required.');
  if (!name) throw new Error('Job name is required.');

  // Field order matches real AF3x JSON files
  const output = { dialect: 'alphafold3', version, name, modelSeeds: seeds, sequences: [] };

  // ── Sequences ─────────────────────────────────────────────────────────────
  document.querySelectorAll('.seq-card').forEach(card => {
    const type    = card.querySelector('.seq-type-label').textContent.toLowerCase();
    const chainRaw = card.querySelector('.seq-chain-id').value.trim();
    if (!chainRaw) throw new Error('All sequence entities need a chain ID.');

    const ids = chainRaw.includes(',')
      ? chainRaw.split(',').map(s => s.trim()).filter(Boolean)
      : chainRaw;

    const seqData = { id: ids };

    if (type === 'ligand') {
      const smilesEl = card.querySelector('.ligand-smiles');
      const ccdEl    = card.querySelector('.ligand-ccd');
      // Active tab determines which to use
      const activePanel = card.querySelector('.ligand-body .tab-panel.active');
      if (activePanel?.dataset.panel === 'smiles') {
        const smiles = smilesEl?.value.trim();
        if (!smiles) throw new Error(`Ligand chain "${chainRaw}": SMILES is empty.`);
        seqData.smiles = smiles;
      } else {
        const ccd = ccdEl?.value.trim();
        if (!ccd) throw new Error(`Ligand chain "${chainRaw}": CCD codes are empty.`);
        seqData.ccdCodes = ccd.split(',').map(s => s.trim()).filter(Boolean);
      }
      output.sequences.push({ ligand: seqData });
      return;
    }

    const seqTA = card.querySelector('.seq-textarea');
    const seq   = (seqTA?.value || '').trim().replace(/\s/g, '');
    if (!seq) throw new Error(`Chain "${chainRaw}": sequence is empty.`);
    seqData.sequence = seq;

    // Modifications
    const mods = [];
    card.querySelectorAll('.mod-row').forEach(row => {
      const code = row.querySelector('.mod-ccd')?.value.trim();
      const pos  = parseInt(row.querySelector('.mod-pos')?.value) || null;
      if (code && pos) {
        if (type === 'protein') mods.push({ ptmType: code, ptmPosition: pos });
        else                    mods.push({ modificationType: code, basePosition: pos });
      }
    });
    if (mods.length) seqData.modifications = mods;

    // MSA — protein and RNA only; DNA has no MSA support in AF3x spec
    if (type === 'protein' || type === 'rna') {
      const msaMode = card.querySelector('.msa-mode-sel')?.value || 'auto';

      if (msaMode === 'none') {
        seqData.unpairedMsa = '';
        if (type === 'protein') seqData.pairedMsa = '';
      } else if (msaMode === 'custom') {
        const unpairedPathEl    = card.querySelector('.msa-unpaired-path');
        const unpairedContentEl = card.querySelector('.msa-unpaired-content');
        const unpairedPath      = unpairedPathEl?.value.trim() || '';
        const unpairedIsUpload  = unpairedPathEl?.dataset.isUpload === 'true';
        const unpairedContent   = unpairedContentEl?.value || '';

        if (unpairedIsUpload && unpairedContent.trim()) {
          seqData.unpairedMsa = unpairedContent;
        } else if (unpairedPath) {
          seqData.unpairedMsaPath = unpairedPath;
        }

        if (type === 'protein') {
          const pairedPathEl    = card.querySelector('.msa-paired-path');
          const pairedContentEl = card.querySelector('.msa-paired-content');
          const pairedPath      = pairedPathEl?.value.trim() || '';
          const pairedIsUpload  = pairedPathEl?.dataset.isUpload === 'true';
          const pairedContent   = pairedContentEl?.value || '';

          if (pairedIsUpload && pairedContent.trim()) {
            seqData.pairedMsa = pairedContent;
          } else if (pairedPath) {
            seqData.pairedMsaPath = pairedPath;
          }
        }
      }
      // 'auto': omit all MSA fields → AF3 generates automatically
    }

    // Templates
    const tplEntries = [];
    card.querySelectorAll('.tpl-entry').forEach(tpl => {
      const mmcifContent  = tpl.querySelector('.tpl-mmcif')?.value.trim()      || null;
      const mmcifPath     = tpl.querySelector('.tpl-mmcif-path')?.value.trim() || null;
      const queryRaw      = tpl.querySelector('.tpl-query-idx')?.value.trim()  || '';
      const tplRaw        = tpl.querySelector('.tpl-tpl-idx')?.value.trim()    || '';

      if (!queryRaw || !tplRaw)
        throw new Error(`Template in chain "${chainRaw}": both query and template indices are required.`);
      if (mmcifContent && mmcifPath)
        throw new Error(`Template in chain "${chainRaw}": provide mmCIF content OR path, not both.`);

      const entry = {};
      if (mmcifPath) entry.mmcifPath = mmcifPath;
      else if (mmcifContent) entry.mmcif = mmcifContent;
      entry.queryIndices    = queryRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      entry.templateIndices = tplRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (entry.queryIndices.length !== entry.templateIndices.length)
        throw new Error(`Template in chain "${chainRaw}": query and template index counts must match.`);
      tplEntries.push(entry);
    });
    if (tplEntries.length) seqData.templates = tplEntries;

    output.sequences.push({ [type]: seqData });
  });

  if (!output.sequences.length) throw new Error('Add at least one sequence entity.');

  // ── Crosslinks ─────────────────────────────────────────────────────────────
  const xlGroups = [];
  document.querySelectorAll('.xl-group-card').forEach(card => {
    const xlId    = card.dataset.id;
    const xlSel   = card.querySelector('.xl-select');
    let   xlName  = xlSel?.value || 'DSSO';

    const xl = CROSSLINKERS.find(x => x.name === xlName);
    if (xl?.dynamic) {
      const n = parseInt(card.querySelector('.xl-dyn-n-input')?.value) || 5;
      xlName  = xlName + n;
    }

    const pairs = [];
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) pairs.push([[c1, p1], [c2, p2]]);
    });

    if (pairs.length) xlGroups.push({ name: xlName, residue_pairs: pairs });
  });
  if (xlGroups.length) output.crosslinks = xlGroups;

  // ── Disulfide bonds ─────────────────────────────────────────────────────────
  const ssPairs = [];
  document.querySelectorAll('.ss-pair-row').forEach(row => {
    const c1 = row.querySelector('.ss-chain-a')?.value.trim();
    const p1 = parseInt(row.querySelector('.ss-pos-a')?.value) || null;
    const c2 = row.querySelector('.ss-chain-b')?.value.trim();
    const p2 = parseInt(row.querySelector('.ss-pos-b')?.value) || null;
    if (c1 && p1 && c2 && p2) ssPairs.push([[c1, p1], [c2, p2]]);
  });
  if (ssPairs.length) output.disulfide_bonds = [{ residue_pairs: ssPairs }];

  // ── Bonded atom pairs ───────────────────────────────────────────────────────
  const bonds = [];
  document.querySelectorAll('.bond-entry').forEach(div => {
    const ea = div.querySelector('.bond-entity-a')?.value.trim();
    const ra = parseInt(div.querySelector('.bond-res-a')?.value) || null;
    const aa = div.querySelector('.bond-atom-a')?.value.trim();
    const eb = div.querySelector('.bond-entity-b')?.value.trim();
    const rb = parseInt(div.querySelector('.bond-res-b')?.value) || null;
    const ab = div.querySelector('.bond-atom-b')?.value.trim();
    if (ea && ra && aa && eb && rb && ab) bonds.push([[ea, ra, aa], [eb, rb, ab]]);
  });
  if (bonds.length) output.bondedAtomPairs = bonds;

  // ── User CCD ────────────────────────────────────────────────────────────────
  const ccdContent = document.getElementById('userCCD')?.value.trim();
  const ccdPath    = document.getElementById('userCCDPath')?.value.trim();
  if (ccdContent && ccdPath) throw new Error('Provide User CCD content OR path, not both.');
  if (ccdContent) output.userCCD     = ccdContent;
  if (ccdPath)    output.userCCDPath = ccdPath;

  return output;
}

// ─── Copy JSON ────────────────────────────────────────────────────────────────

function _copyJSON() {
  const text = document.getElementById('jsonOutput').textContent;
  if (!text || text.startsWith('//')) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyJsonBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ─── Arc Diagram Update ───────────────────────────────────────────────────────

let _autoSaveTimer = null;

export function updateViz() {
  const svg = document.getElementById('arc-svg');
  if (!svg) return;

  const chains   = _readChainsFromDOM();
  const xlGroups = _readXlGroupsFromDOM();
  const ssBonds  = _readSsBondsFromDOM();

  drawArcDiagram(svg, chains, xlGroups, ssBonds);
  _rewireArcEvents(svg);
  updateXlStats();
  _validateAll();

  // Debounced auto-save
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(_tryAutoSave, 1500);
}

function _readChainsFromDOM() {
  const chains = [];
  document.querySelectorAll('.seq-card').forEach((card, cardIdx) => {
    const type     = card.querySelector('.seq-type-label')?.textContent.toLowerCase();
    if (type === 'ligand') return; // skip ligands in arc diagram

    const chainRaw  = card.querySelector('.seq-chain-id')?.value.trim() || '';
    const colorIdx  = parseInt(card.dataset.colorIdx) || cardIdx;
    const seqTA     = card.querySelector('.seq-textarea');
    const seqLen    = seqTA ? (seqTA.value.trim().replace(/\s/g,'').length || 0) : 0;

    const ids = chainRaw.includes(',')
      ? chainRaw.split(',').map(s => s.trim()).filter(Boolean)
      : chainRaw ? [chainRaw] : [];

    ids.forEach(id => {
      chains.push({ id, label: id, length: seqLen || null, colorIdx });
    });
  });
  return chains;
}

function _readXlGroupsFromDOM() {
  const groups = [];
  document.querySelectorAll('.xl-group-card').forEach((card, gi) => {
    const xlId   = card.dataset.id;
    const xlSel  = card.querySelector('.xl-select');
    let   xlName = xlSel?.value || '';
    const xl     = CROSSLINKERS.find(x => x.name === xlName);
    if (xl?.dynamic) {
      const n = parseInt(card.querySelector('.xl-dyn-n-input')?.value) || 5;
      xlName  = xlName + n;
    }

    const color = XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
    const pairs = [];

    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) pairs.push({ chain1: c1, pos1: p1, chain2: c2, pos2: p2 });
    });

    if (pairs.length) groups.push({ name: xlName, color, pairs });
  });
  return groups;
}

function _readSsBondsFromDOM() {
  const bonds = [];
  document.querySelectorAll('.ss-pair-row').forEach(row => {
    const c1 = row.querySelector('.ss-chain-a')?.value.trim();
    const p1 = parseInt(row.querySelector('.ss-pos-a')?.value) || null;
    const c2 = row.querySelector('.ss-chain-b')?.value.trim();
    const p2 = parseInt(row.querySelector('.ss-pos-b')?.value) || null;
    if (c1 && p1 && c2 && p2) bonds.push({ chain1: c1, pos1: p1, chain2: c2, pos2: p2 });
  });
  return bonds;
}

// ─── Batch export / Screening ─────────────────────────────────────────────────

/** Extract all crosslink pairs from the DOM as flat objects. */
function _getAllCrosslinkPairs() {
  const all = [];
  document.querySelectorAll('.xl-group-card').forEach(card => {
    const xlSel = card.querySelector('.xl-select');
    let xlName  = xlSel?.value || 'DSSO';
    const xl    = CROSSLINKERS.find(x => x.name === xlName);
    if (xl?.dynamic) {
      const n = parseInt(card.querySelector('.xl-dyn-n-input')?.value) || 5;
      xlName  = xlName + n;
    }
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) all.push({ xlName, pair: [[c1, p1], [c2, p2]] });
    });
  });
  return all;
}

/** Group [{xlName, pair}] → [{name: xlName, residue_pairs: [...]}] for JSON output. */
function _groupByXLName(items) {
  const map = new Map();
  for (const { xlName, pair } of items) {
    if (!map.has(xlName)) map.set(xlName, []);
    map.get(xlName).push(pair);
  }
  return [...map.entries()].map(([name, residue_pairs]) => ({ name, residue_pairs }));
}

/** Build a complete JSON but replace the crosslinks field with the given groups. */
function _buildJSONWithXL(xlGroups) {
  const out = _buildJSON();
  if (xlGroups && xlGroups.length) {
    out.crosslinks = xlGroups;
  } else {
    delete out.crosslinks;
  }
  return out;
}

/** Create and trigger download of a ZIP archive. */
async function _downloadZip(files, zipFilename) {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.content));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function _batchSingleXL() {
  const btn = document.getElementById('batchSingleBtn');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    const allPairs = _getAllCrosslinkPairs();
    if (!allPairs.length) { alert('No crosslink pairs loaded.'); return; }

    const base    = _buildJSON();  // validates required fields, throws on error
    const jobName = base.name || 'job';

    const files = allPairs.map(({ xlName, pair }) => {
      const label = `${xlName}_${pair[0][0]}${pair[0][1]}-${pair[1][0]}${pair[1][1]}`;
      const json  = _buildJSONWithXL([{ name: xlName, residue_pairs: [pair] }]);
      json.name   = `${jobName}_${label}`;
      return { name: `${jobName}_${label}.json`, content: JSON.stringify(json, null, 2) };
    });

    await _downloadZip(files, `${jobName}_single_xl.zip`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download ZIP';
  }
}

async function _batchRandomCombos() {
  const btn = document.getElementById('batchComboBtn');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    const allPairs = _getAllCrosslinkPairs();
    const k = parseInt(document.getElementById('batchComboK').value) || 5;
    const m = parseInt(document.getElementById('batchComboM').value) || 20;

    if (!allPairs.length) { alert('No crosslink pairs loaded.'); return; }
    if (k > allPairs.length) {
      alert(`k=${k} exceeds available pairs (${allPairs.length}). Reduce k.`);
      return;
    }

    const base    = _buildJSON();
    const jobName = base.name || 'job';
    const files   = [];

    for (let i = 0; i < m; i++) {
      // Fisher-Yates partial shuffle to pick k random items
      const pool = [...allPairs];
      for (let j = 0; j < k; j++) {
        const r = j + Math.floor(Math.random() * (pool.length - j));
        [pool[j], pool[r]] = [pool[r], pool[j]];
      }
      const chosen   = pool.slice(0, k);
      const xlGroups = _groupByXLName(chosen);
      const json     = _buildJSONWithXL(xlGroups);
      const label    = `${jobName}_combo_${String(i + 1).padStart(3, '0')}`;
      json.name      = label;
      files.push({ name: `${label}.json`, content: JSON.stringify(json, null, 2) });
    }

    await _downloadZip(files, `${jobName}_combos_k${k}_n${m}.zip`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download ZIP';
  }
}

/** Refresh batch export info labels (called on panel open and input changes). */
function _updateBatchInfo() {
  const n          = _getAllCrosslinkPairs().length;
  const singleInfo = document.getElementById('batchSingleInfo');
  if (singleInfo) {
    singleInfo.textContent = `${n} pair${n !== 1 ? 's' : ''} → ${n} JSON file${n !== 1 ? 's' : ''}`;
  }

  const k         = parseInt(document.getElementById('batchComboK')?.value) || 5;
  const m         = parseInt(document.getElementById('batchComboM')?.value) || 20;
  const comboInfo = document.getElementById('batchComboInfo');
  if (!comboInfo) return;
  if (n === 0) {
    comboInfo.textContent  = 'No crosslink pairs loaded.';
    comboInfo.style.color  = 'var(--warning)';
  } else if (k > n) {
    comboInfo.textContent  = `⚠ k=${k} exceeds available pairs (${n}) — reduce k`;
    comboInfo.style.color  = 'var(--warning)';
  } else {
    const coverage = n > 0 ? ((k / n) * 100).toFixed(0) : 0;
    comboInfo.textContent  = `${m} jobs × ${k} XLs each  (${coverage}% of ${n} pairs per job)`;
    comboInfo.style.color  = '';
  }
}

// ─── Arc click ↔ pair row highlight ──────────────────────────────────────────

function _rewireArcEvents(svg) {
  svg.querySelectorAll('.xl-arc').forEach(arc => {
    arc.addEventListener('click', () => {
      const [c1, p1, c2, p2] = arc.getAttribute('data-key').split(':');
      let found = null;
      document.querySelectorAll('.xl-pair-row').forEach(row => {
        if (row.querySelector('.xl-chain-a')?.value.trim() === c1 &&
            String(row.querySelector('.xl-pos-a')?.value).trim() === p1 &&
            row.querySelector('.xl-chain-b')?.value.trim() === c2 &&
            String(row.querySelector('.xl-pos-b')?.value).trim() === p2) {
          found = row;
        }
      });
      if (found) {
        found.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        found.classList.remove('xl-row-flash');
        // Force reflow so animation restarts
        void found.offsetWidth;
        found.classList.add('xl-row-flash');
      }
    });
  });
}

export function wireXlPairRowHover(row) {
  row.addEventListener('mouseenter', () => {
    const c1 = row.querySelector('.xl-chain-a')?.value.trim();
    const p1 = row.querySelector('.xl-pos-a')?.value.trim();
    const c2 = row.querySelector('.xl-chain-b')?.value.trim();
    const p2 = row.querySelector('.xl-pos-b')?.value.trim();
    if (!c1 || !p1 || !c2 || !p2) return;
    const key = `${c1}:${p1}:${c2}:${p2}`;
    document.querySelectorAll(`.xl-arc[data-key="${CSS.escape(key)}"]`).forEach(arc => {
      arc.setAttribute('stroke-width', '3.5');
      arc.setAttribute('opacity', '1');
    });
  });
  row.addEventListener('mouseleave', () => {
    document.querySelectorAll('.xl-arc').forEach(arc => {
      arc.setAttribute('stroke-width', '1.8');
      arc.setAttribute('opacity', '0.8');
    });
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function _validateAll() {
  _checkDuplicateChainIds();
  _checkXlPositions();
}

function _checkDuplicateChainIds() {
  const seen = {};
  document.querySelectorAll('.seq-card').forEach(card => {
    const input = card.querySelector('.seq-chain-id');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    // Multi-chain (comma-separated)
    val.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
      if (!seen[id]) seen[id] = [];
      seen[id].push(input);
    });
  });

  document.querySelectorAll('.seq-chain-id').forEach(input => {
    const warn = input.closest('.seq-chain-id-wrap')?.querySelector('.chain-id-dup-warn');
    const ids  = (input.value.trim()).split(',').map(s => s.trim()).filter(Boolean);
    const isDup = ids.some(id => seen[id] && seen[id].length > 1);
    if (warn) warn.style.display = isDup ? 'inline' : 'none';
    input.classList.toggle('input-warning', isDup);
  });
}

function _checkXlPositions() {
  // Build chain → sequence length map
  const chainLen = {};
  document.querySelectorAll('.seq-card').forEach(card => {
    const chainRaw = card.querySelector('.seq-chain-id')?.value.trim() || '';
    const seq      = card.querySelector('.seq-textarea')?.value.replace(/\s/g, '') || '';
    const len      = seq.length;
    if (!len) return;
    chainRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
      chainLen[id] = len;
    });
  });

  document.querySelectorAll('.xl-pair-row').forEach(row => {
    const warn = row.querySelector('.xl-pos-warn');
    const c1   = row.querySelector('.xl-chain-a')?.value.trim();
    const p1   = parseInt(row.querySelector('.xl-pos-a')?.value) || 0;
    const c2   = row.querySelector('.xl-chain-b')?.value.trim();
    const p2   = parseInt(row.querySelector('.xl-pos-b')?.value) || 0;

    let msg = '';
    if (c1 && p1 && chainLen[c1] && p1 > chainLen[c1]) {
      msg = `${c1}: pos ${p1} > len ${chainLen[c1]}`;
    } else if (c2 && p2 && chainLen[c2] && p2 > chainLen[c2]) {
      msg = `${c2}: pos ${p2} > len ${chainLen[c2]}`;
    }

    if (warn) {
      warn.textContent   = msg ? `⚠ ${msg}` : '';
      warn.style.display = msg ? 'inline' : 'none';
    }
  });
}

// ─── localStorage auto-save / restore ────────────────────────────────────────

const LS_KEY      = 'af3x_autosave';
const LS_TIME_KEY = 'af3x_autosave_time';

function _tryAutoSave() {
  try {
    const json = _buildJSON();
    localStorage.setItem(LS_KEY, JSON.stringify(json));
    localStorage.setItem(LS_TIME_KEY, new Date().toISOString());
  } catch { /* ignore if form is incomplete */ }
}

function _checkRestoreSession() {
  const saved = localStorage.getItem(LS_KEY);
  const time  = localStorage.getItem(LS_TIME_KEY);
  if (!saved) return;

  const banner = document.getElementById('restoreBanner');
  if (!banner) return;

  const when = time ? new Date(time).toLocaleString() : 'previously';
  banner.querySelector('#restoreBannerTime').textContent = when;
  banner.style.display = 'flex';

  document.getElementById('restoreSessionBtn').addEventListener('click', () => {
    try {
      const json = JSON.parse(saved);
      _populateFromJSON(json);
      banner.style.display = 'none';
    } catch (e) {
      alert('Could not restore session: ' + e.message);
    }
  });

  document.getElementById('dismissRestoreBtn').addEventListener('click', () => {
    banner.style.display = 'none';
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_TIME_KEY);
  });
}

// ─── PDB / mmCIF import ───────────────────────────────────────────────────────

function _handlePdbFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    openPdbModal(ev.target.result, _onPdbImport);
  };
  reader.readAsText(file);
  e.target.value = '';
}

function _onPdbImport(chains) {
  // Assign chain IDs A, B, C... starting after the last existing card
  const existingIds = new Set();
  document.querySelectorAll('.seq-chain-id').forEach(el => {
    (el.value || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => existingIds.add(id));
  });

  let nextCharCode = 65; // 'A'
  function _nextFreeId() {
    while (existingIds.has(String.fromCharCode(nextCharCode)) && nextCharCode < 91) nextCharCode++;
    const id = nextCharCode < 91 ? String.fromCharCode(nextCharCode) : `Z${nextCharCode - 90}`;
    existingIds.add(id);
    nextCharCode++;
    return id;
  }

  chains.forEach(chain => {
    const type = chain.type === 'dna' ? 'dna'
               : chain.type === 'rna' ? 'rna'
               : chain.type === 'ligand' ? 'ligand'
               : 'protein';

    addSequenceCard(type);
    const card = document.querySelector('#sequences-container .seq-card:last-child');
    if (!card) return;

    const chainIdInput = card.querySelector('.seq-chain-id');
    if (chainIdInput) chainIdInput.value = _nextFreeId();

    if (type === 'ligand') {
      // Switch to CCD tab and set the code
      const ccdBtn = card.querySelector('[data-tab="ccd"]');
      const smilesBtn = card.querySelector('[data-tab="smiles"]');
      if (ccdBtn) ccdBtn.click();
      const ccdInput = card.querySelector('.ligand-ccd');
      if (ccdInput && chain.ccdCode) ccdInput.value = chain.ccdCode;
    } else {
      const ta = card.querySelector('.seq-textarea');
      if (ta && chain.sequence) {
        ta.value = chain.sequence;
        const typeName = type === 'dna' ? 'dna' : type === 'rna' ? 'rna' : 'protein';
        _autoValidateSeq(ta, typeName);
        _updateRuler(card);
      }
    }
  });

  updateViz();
}
