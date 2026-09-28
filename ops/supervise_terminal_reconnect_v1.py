#!/usr/bin/env python3
"""One bounded changed acquisition with kernel signal provenance, without retry."""
import pathlib
import sys
from supervise_terminal_map_v3 import supervise

if __name__ == '__main__':
    out = str(pathlib.Path(sys.argv[1]).absolute())
    sys.exit(supervise(out, ['python3', 'ops/run_terminal_map_v3.py', out]))
