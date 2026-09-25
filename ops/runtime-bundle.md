# Runtime packaging for TASK-226

`prepare_runtime_bundle.py` implements the local paired source/runtime byte
packaging operation. It is not yet wired into the production release gate.
The mandatory finalized TASK-225 proof must pass before a real candidate is
staged. Diagnostic fixtures cannot establish this prerequisite.

The caller supplies `prepare(client, server, sources, runtime, dependencies,
verified_runtime, out, stop_at)` with Path objects and the parent's cumulative
Unix deadline. `out` must not exist. `sources` uses the existing source packager
format. `verified_runtime` must come from the successful verification invocation,
not an inventory freshly invented at packaging time. It contains:

```json
{
  "source_manifest_sha256": "SHA-256 of the exact source-manifest file",
  "identity": {"node": "v20.20.2", "platform": "linux", "arch": "x64"},
  "runtime": {"bin/node": {"type": "file", "mode": 493, "sha256": "..."}},
  "dependencies": {"...": {"type": "file", "mode": 420, "sha256": "..."}}
}
```

The example inventories are abbreviated; actual receipts contain every file,
directory, and link produced by `snapshot(root, stop_at)`. The gate must bind the
receipt to its audited test evidence. Identity strings alone are not executable
verification. This operation compares complete inventories, including modes and
relative symlink targets. It rejects links outside each root, broken links,
special files, privileged modes, artifacts and Git data. Direct package names and
versions must agree with the source archive's package manifest and lockfile.
Transitive bytes are bound by the complete tested inventory; this is not a new
dependency installation or an independent npm dependency-graph audit.

Output includes the existing source archive, scoped source patches and source
manifest, plus `runtime-dependencies.tar.gz` and `paired-package.json`. Runtime
paths start with `runtime/`; dependencies use
`diplomacy_server/server/node_modules/` beside the source pair. The runtime
archive is deterministic and read back against the complete expected inventory.
The caller must check both archive digests before extraction or use. Packaging
does not execute the archived binary or claim target-host ABI compatibility.

The paired receipt explicitly says `releaseReady: false`. It does not replace
the final release manifest, current rollback capture, guarded local dry-run,
authenticated expiring smoke inputs, or full gate. Failures after source output
creation retain partial files for diagnosis and do not publish a paired receipt.
A retry needs a new output directory. Activation remains TASK-227.

Run `python3 ops/test_prepare_runtime_bundle.py` for the isolated controls. These
use temporary repositories and synthetic runtime/package bytes; no real release,
service, browser, public identity, or database is touched. They also preserve and
test source-file snapshotting when an installed file changes during archiving.
