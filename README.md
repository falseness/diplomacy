# diplomacy

## Artifact storage

Store large generated artifacts under `/mnt/storage/diplomacy_demons` to avoid
filling the system disk. This checkout's `artifacts/` directory is a symlink to
`/mnt/storage/diplomacy_demons/artifacts`, so existing artifact paths continue to
work. Keep that storage mount available when running tests or agent workflows.

## Tests

The tests live in the server repository (`../diplomacy_server`, checked out next to
this one) and load the client sources from here (`DIPLOMACY_CLIENT_ROOT`, default
`/root/diplomacy`). Run them through the server's registry-driven runner:

```
npm test              # cd ../diplomacy_server && tests/run.sh  (exhaustive-local profile)
npm run test:fast     # cd ../diplomacy_server && TEST_PROFILE=fast tests/run.sh
```

`TEST_JOBS=N` runs N suites at a time and `TEST_OUTPUT_DIR` sets the evidence
directory; see `tests/run.sh` and `tests/reliability/registry.js` in the server repo.
