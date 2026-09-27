# TASK-225: remaining fog criterion records

`review_fog_records.js` reviews complete TASK-212 AC4, AC5, AC6, AC7 and AC8 independently. It reads the retained review-77 provider through the review-78 selection; it does not launch services. AC1/2/3 and all TASK-211 reviews remain owned by their existing readers. The raw-world visibility oracle is recomputed, including action, stale-delivery and reconnect assertions.

The original fog provider command exited zero. Its enclosing review-77 launcher exited 143; these are separate facts. Only the provider command's finalized receipt establishes its exit. Original TASK-212/green-06 selection failure is retained and hash-bound by AC5. No full TASK-225 success is claimed.

Run a fresh bounded continuation from the client repository:

```sh
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 ops/run_fog_records.js \
  /root/diplomacy/artifacts/TASK-225/review-78/reviewed-crosswalk.json \
  /root/diplomacy/artifacts/TASK-225/<fresh-directory>
```

Capture the OS process exit with an external supervisor; `PLANNED_RUNNER_EXIT` is not that receipt. The runner declares cases first and shares a 55-minute stop deadline across commands and consumption. An external process timeout must clean up the owned process group before 60 minutes. There are no services owned by this offline reader.

The selection includes an explicit hash-bound baseline, projected provider, exact criterion owners, finalized provider receipt and reader hash. `evidence_fog_records_gate.js` installs the adapter at the actual `A.inventory` boundary. It freshly validates the baseline through the preceding adapters, then consumes each new whole criterion, asserting unchanged non-target rows, historical annex, research and eight self checks. The new manifest retains every original selected proof. Saved inventory verdicts are never trusted.

Resume the resulting `reviewed-crosswalk.json` with:

```sh
NODE_OPTIONS='--require /root/diplomacy/ops/evidence_fog_records_gate.js'
```

This is the preload interface for the eventual gate; do not launch that gate until all required prior local targets are resolved. The runner's 126-to-121 expectation is specific to this five-criterion continuation, not a general completion threshold. Later tasks remain informational. Remaining research, G09 workload/progress, long-phase and natural-clock requirements are unchanged.

Semantic tests alter copied evidence and rebind its local hash before checking rejection, so they exercise content rather than merely hash mismatches. Consumer controls separately reject deleted/tampered proof, wrong owner/receipt/release, omitted retained rows and a changed annex. Existing archives are never edited.
