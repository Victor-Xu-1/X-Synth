# Real Case Testing

Acceptance uses the configured ASKCOS runtime, real Mongo and the immutable
commercial stock index. MCTS, RetroStar, ExpandOne and learned models must not
be replaced by mock providers or manually authored chemistry routes. Optional
engines and native capabilities are not prerequisites for this product path.

Each target must verify:

1. task submitted through the actual route-generation entrypoint
2. history record created
3. route count recorded
4. closure status recorded
5. route families are not all identical
6. failed or unclosed tasks are not marked completed
7. each selected leaf has exact catalog evidence from the search snapshot
8. template reconstruction and fast-filter checks are not labelled experimental proof
9. interruption resumes the same child ID and graph, without resubmitting finished stages
10. cancellation cannot be overwritten by a late engine result

The affected-path gates are: Python regression and API security; frontend
state/interaction tests and build; dependency audits; real Chrome desktop/mobile
input, history refresh and route viewing; real inference/stock/database tests;
and performance under real search load. Performance targets have one authority
in current-architecture.md and packages/platform/performance.py.

Keep evidence outside source. Small public benchmark decoder fixtures include
execution provenance and hashes; they are not providers or acceptance substitutes.
