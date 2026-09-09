# TASK-102 movement matrix initialization experiment

Actual predecessor: b7d54e6f82f8d0b02d4f9b70067ec5f46bbedd27.
Production remains unchanged until this experiment justifies promotion.

`Way.initialization` creates fresh used, distance and parent matrices on each
search. The candidate fills the first two rows with native Array.fill rather
than assigning the same primitive in each JavaScript inner-loop iteration.
The parent loop and all coordinate allocations remain unchanged. This changes
neither queue traversal nor passability, and retains no arrays across searches
or games. It is distinct from the closed queue and passability experiments.
The existing allocation study identifies this real producer; no sampled share
is treated as a forecast of full canonical speed.

Freeze source, tooling, Node and checkpoint hashes in
`artifacts/TASK-102/way-fill/manifest.json`. Run the separate oracle, then fixed
A/B/B/A fresh processes with symmetric script transformation and forwarding.
Use the unchanged six teacher/six component fixtures and preserve every complete
result. Keep the historical inferenceSource string identical for byte equality.
The oracle compares real initial matrices, fresh row/coordinate ownership and
origin identity. The negative control must reject an off-by-one distance in a
real teacher game. Timed processes contain no oracle instrumentation.

Predeclared promotion screen: at least 10% bounded mean improvement in both
teacher and component groups, with complete identical results and script hashes
matching the declared transformation. All pairs and within-arm ranges remain
reported; no replacement runs or overhead subtraction. A passing screen would
only justify a frozen production candidate, its complete determinism/invariant
tests and both original actual-predecessor median-of-three speed gates. A failing
screen closes this experiment and leaves TASK-102 pending without another
unchanged full acceptance run. Bounded means never establish acceptance.
