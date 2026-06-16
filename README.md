# AF3x Input Generator

A browser-based JSON input generator for [AF3x](https://github.com/KosinskiLab/af3x) — the AlphaFold 3 extension for explicit crosslink modelling.

Built as a pure static site (vanilla HTML/CSS/ES-modules), deployable on GitHub Pages with no build step.

## Features

### Sequences
- **Protein, RNA, DNA, Ligand** entities with full AF3x field support
- Multiple input modes: type directly, paste FASTA, upload FASTA file, or fetch from **UniProt ID** (live API call)
- Sequence validation (checks for invalid characters per molecule type)
- Homomer support via comma-separated chain IDs (e.g. `A,B,C`)

### Crosslinks
- All **16 official AF3x crosslinkers** in a grouped dropdown:
  - Symmetric NHS-ester: DSSO, DSS, BS3, DSG, BS2G, DSBU, CDI, PHOX, BSPEG5, BSPEG9
  - Asymmetric (order matters!): SDA, SDA25A, LCSDA, SDAD, azide-A-DSBSO
  - Dynamic: LINK\<n\> (flexible carbon chain), RIGID\<n\> (rigid aromatic rings)
- **Warning banner** for asymmetric crosslinkers explaining residue order requirement
- **CSV import**: upload xiVIEW or xiNET crosslink CSVs → auto-detect format → choose which pairs to import → assign proteins to chain IDs

### Disulfide Bonds
- Separate section using the `disulfide_bonds` JSON field
- AF3x models these by mutating Cys→Ala and adding S–S covalent ligands

### Post-Translational Modifications
- **PTM picker modal** with 50+ modifications searchable by name or CCD code
- Categories: Phosphorylation, Acetylation/Methylation, Hydroxylation, D-amino acids, RNA/DNA modifications, and more
- Works for protein PTMs (`ptmType`/`ptmPosition`) and RNA/DNA base modifications

### Advanced (collapsible)
- MSA configuration (unpaired/paired content or file paths)
- Structural templates (mmCIF content or path + 0-based query/template indices)
- Bonded atom pairs (covalent bonds for glycans, covalent ligands)
- User-provided CCD (inline mmCIF content only — AF3x has no path option for this field)

### Output
- **Generate JSON** — validates all fields, produces AF3x-compatible JSON
- **Copy to clipboard** / **Download** as `.json`
- **Import JSON** — load an existing AF3x JSON file to edit

### Topology Visualisation
- Live **arc diagram** showing all chains as coloured bars and crosslinks as bezier arcs
- Updates in real time as sequences and crosslinks are added
- Tooltip on hover shows crosslinker name and residue positions

## CSV Import Format

The importer auto-detects two formats from column names:

| Format | Required columns |
|--------|-----------------|
| **xiVIEW** | `Protein1`, `Protein2`, `AbsPos1`, `AbsPos2`, `Score` |
| **xiNET**  | `Protein1`, `Protein2`, `LinkPos1`, `LinkPos2`, `Score` (optional `PepPos1`, `PepPos2`) |

After parsing, you can filter by minimum score, exclude decoys, restrict to inter-protein links, and select individual pairs before importing.

## JSON Format (AF3x)

```json
{
  "dialect": "alphafold3",
  "version": 1,
  "name": "my_complex",
  "modelSeeds": [1, 2, 3],
  "sequences": [
    { "protein": { "id": "A", "sequence": "MKVL..." } },
    { "ligand":  { "id": "L", "ccdCodes": ["ATP"] } }
  ],
  "crosslinks": [
    { "name": "DSSO", "residue_pairs": [[["A", 104], ["B", 43]]] }
  ],
  "disulfide_bonds": [
    { "residue_pairs": [[["A", 14], ["A", 20]]] }
  ]
}
```

## Local development

Open `index.html` via a local server (required for ES modules):

```bash
python -m http.server 8080
# → http://localhost:8080
```

Or use the VS Code Live Server extension.

## Deployment

Live at **https://lucxegg.github.io/af3x-input-generator/**, served via GitHub Pages
(Settings → Pages → Source: Deploy from branch → `main` / root). Every push to `main`
redeploys automatically.

To transfer to the KosinskiLab organisation, use **Settings → Transfer ownership**.
