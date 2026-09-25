# diplomacy

## Artifact storage

Store large generated artifacts under `/mnt/storage/diplomacy_demons` to avoid
filling the system disk. This checkout's `artifacts/` directory is a symlink to
`/mnt/storage/diplomacy_demons/artifacts`, so existing artifact paths continue to
work. Keep that storage mount available when running tests or agent workflows.
