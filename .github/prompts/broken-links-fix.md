You are fixing broken internal links in the Research and Desire Mintlify docs. The docs repo is your current working directory.

# Goal

Resolve every broken internal link reported by `mint broken-links` by editing the offending `.mdx` files in place. Only make changes where the correct target is obvious from the repo. Never invent pages or paths.

# Inputs

A file named `broken-links.txt` in the repo root contains the full output of `pnpm mint:broken-links`. Each broken link is listed under the file that contains it, in this shape:

```
found N broken links in M files

path/to/source.mdx
 ⎿  /path/that/is/broken
 ⎿  /another/broken/path
```

# How to fix

For each broken link:

1. Open the source `.mdx` file and find the broken reference.
2. Figure out the correct target by searching the docs:
   - Look for a file whose `slug`/path matches the broken target after trivial renames (e.g. the broken link points to an old folder name that now has a new name — pick the renamed page).
   - Use `docs.json` (or `mint.json`) navigation if the path looks like a sidebar entry.
   - Match by the last path segment, case-insensitive, across `Documentation/**/*.mdx`.
3. Pick the fix with the most evidence:
   - **Rewrite the link** to the existing page if one obviously matches.
   - **Point it up a level** to the nearest index/overview page only when there is clearly no direct replacement.
   - **Leave it alone and flag it** (no edit, include in findings) if you are not confident.
4. Never delete the surrounding prose, card, or list item — only change the `href`/link target.

# Scope constraints

- Only edit files under `Documentation/**/*.mdx`.
- Do not create new pages. Do not rename existing pages. Do not touch `docs.json` / `mint.json`.
- Preserve all other markdown/MDX content exactly (whitespace, components, frontmatter).
- Do not fix external (http/https) links — those are handled elsewhere.

# Output

Emit exactly one JSON object as the final line of stdout and stop:

- If `broken-links.txt` is empty or missing:
  ```json
  {"status":"ok","findings":[]}
  ```

- If all reported broken links were fixed with confidence:
  ```json
  {
    "status":"fixed",
    "findings":[
      {
        "file":"ossm/Software/architecture/folder-structure.mdx",
        "broken":"/ossm/Software/getting-started/display",
        "fix":"/ossm/Software/getting-started/display-overview",
        "confidence":"high"
      }
    ]
  }
  ```

- If some links could not be fixed confidently (still edit the ones that could):
  ```json
  {
    "status":"partial",
    "findings":[
      {"file":"...","broken":"...","fix":"...","confidence":"high"},
      {"file":"...","broken":"...","fix":null,"confidence":"none","reason":"no matching page exists; needs human review"}
    ]
  }
  ```

# Rules

- Final stdout line must be one of the JSON objects above. No other prose around it.
- If a broken link appears in multiple files, fix all occurrences and include one finding per (file, broken) pair.
- Do not write any file other than the `.mdx` files containing broken links.
