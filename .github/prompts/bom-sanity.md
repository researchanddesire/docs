You are auditing the OSSM (Open Source Sex Machine) bills of materials (BOMs) in the Research and Desire docs repo. The docs repo is your current working directory. The full OSSM hardware/firmware/CAD repo has been checked out alongside it at `./ossm-context/` for cross-reference.

# Goal

Determine whether every BOM table in the OSSM documentation is internally consistent and physically reasonable when cross-checked against the OSSM source-of-truth repo. If you find issues, fix them in place. If everything looks fine, do nothing.

# Inputs

1. **BOM tables to audit** — every markdown table inside any `.mdx` file under `Documentation/ossm/`. Pay closest attention to:
   - `Documentation/ossm/Hardware/getting-started/bom.mdx` (master BOM)
   - `Documentation/ossm/Hardware/standard-printed-parts/actuator/introduction.mdx`
   - `Documentation/ossm/Hardware/standard-printed-parts/stand/introduction.mdx`
   - Any other BOM-like tables you discover under `Documentation/ossm/Hardware/`.

2. **Source of truth** — the OSSM repo at `./ossm-context/`. Explore it freely. Useful starting points:
   - `./ossm-context/README.md`
   - `./ossm-context/Hardware/` (CAD, exploded views, assembly diagrams, fastener lists)
   - `./ossm-context/Software/src/` (firmware — pin maps, motor specs, BLE protocol, etc.)
   - Any BOM, CSV, or parts-list files in the repo.

# Sanity checks to perform

For each BOM table, verify:

1. **Counts are physically plausible.** Examples:
   - Number of nuts ≥ number of screws of the same thread that pass through clearance holes (with sensible exceptions for screws that thread directly into printed parts or T-slots).
   - 4 feet for 4 corners, 4 brackets for 4 joints, etc.
   - Bearing count matches the number of pulleys/idlers shown in the assembly.
   - Printed-part counts match the number of distinct named parts.
2. **Dimensions match the design.** Examples:
   - Linear rail length follows the documented formula (stroke + 180mm in OSSM).
   - Belt length is enough for the rail's travel.
   - Extrusion lengths match what the assembly diagrams in `ossm-context` show.
3. **Part names match the firmware/hardware reality.** Examples:
   - Motor name (e.g. `57AIM30 Gold Motor`) matches what the firmware and Hardware folder reference.
   - Pulley spec (tooth count, bore, width) matches the belt path.
   - Linear rail designation (`MGN12H` not `MGN12C`) matches the spec called out in `ossm-context`.
4. **Cross-page consistency.** The master BOM (`bom.mdx`) and per-section BOMs (`actuator/introduction.mdx`, `stand/introduction.mdx`) must agree. If `bom.mdx` says 18 M3x8 screws, the actuator page must say the same thing (or a superset that obviously rolls up).
5. **Totals add up.** If a section claims to be the union of sub-sections (e.g. "Hardware - Bag 1/2/3"), the parts in those bags should plausibly add up to what the assembly needs.

# What to do with findings

- **Everything looks reasonable** — do not edit any files. Print exactly this JSON to stdout and stop:
  ```json
  {"status":"ok","findings":[]}
  ```

- **You found issues** — edit the offending `.mdx` files in place to fix them. Be conservative: only change a number or a part name if the OSSM repo gives you clear evidence that the doc is wrong. Do not invent parts or quantities; if you are uncertain, flag it as a finding without editing. Then print this JSON to stdout and stop:
  ```json
  {
    "status":"issues",
    "findings":[
      {
        "file":"Documentation/ossm/Hardware/getting-started/bom.mdx",
        "section":"M3 Hardware",
        "issue":"Doc lists 10 M3 hex nuts but actuator assembly diagram shows 13 M3 nut pockets",
        "fix":"Updated quantity from 10 to 13",
        "evidence":"ossm-context/Hardware/Actuator/exploded.png + ossm-context/Hardware/BOM.csv"
      }
    ]
  }
  ```

# Rules

- Only emit one of the two JSON objects above as your final output. No other prose around it.
- Do not edit anything outside `Documentation/ossm/`.
- Do not delete files. Do not add new files. Only modify existing `.mdx` BOM tables.
- Preserve markdown table formatting exactly (pipes, alignment, header rows).
- If `ossm-context/` is missing or empty, return `{"status":"ok","findings":[]}` rather than guessing.
