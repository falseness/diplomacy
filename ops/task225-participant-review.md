# TASK-225 independent participant clause

`prepare_concurrent_participants.py` consumes the review-41 selected archive and
adds a complete TASK-209/AC1 review while preserving AC2 and every other review.
It checks actual four-context observations against four browser packet/input
streams, independently bound MongoDB rosters, ten protocol recipients, concurrent
progress, production server/database readiness, served assets, and cleanup.
The existing independent board readers check received state and every revision.
Ten-player UI, G09 long phases, and overall audit completion are not claimed.

```sh
python3 ops/prepare_concurrent_participants.py \
  artifacts/TASK-225/review-41/prepared/reviewed-crosswalk.json /tmp/ac1-prepared
TASK225_RECIPIENT_ARCHIVE=/root/diplomacy/artifacts/TASK-225/review-41/prepared/selected-209 \
  python3 -m unittest discover -s ops -p test_review_concurrent_participants.py -v
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 \
  ops/consume_concurrent_participants.js /tmp/ac1-prepared /tmp/ac1-consumed \
  /root/diplomacy/artifacts/TASK-225/review-41/prepared/reviewed-crosswalk.json TASK-209/AC1
```

The actual consumer inventories current sources once; before/after dispositions
use identical measured runs and raw proof, differing only in AC1. It requires
covered-current, preserves all other dispositions and eight self checks, and
rejects deleted/tampered packet and review copies. Raw-proof unit controls also
reject matching-but-wrong context counts, wrong roster identity, duplicate
production server, missing readiness, altered served source and sequential games.

Keep the original `consume_concurrent_review.js` unchanged: it is itself part
of the review-41 provider source snapshot. The separate participant comparison
avoids invalidating that accepted source identity. New reviewer files are bound
separately in selection and handoff evidence. A later selection index is not
an original worker receipt. Never rewrite old archive files or transplant proof.
