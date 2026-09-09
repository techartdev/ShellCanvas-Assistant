# Verification

Development checkpoint, 2026-09-10. This file separates actual evidence from
remaining checks and will be updated as the integration run proceeds.

- The independent project builds through the packaged SDK with no desktop
  source imports. The CLI validates its self-contained artifact and emits the
  repository manifest/hash.
- Five deterministic tests pass: split UTF-8/SSE, streamed tool round-trip,
  rejection of unfinished/malformed streams before tool execution, canceled
  tool results, and chunked history with stale-writer rejection.
- ShellCanvas's new network broker tests check permission denial before native
  access, host-owned identity, bounded stream chunks and late-start cancellation.
- The desktop repository tests check unsafe paths, changed bytes, identity
  mismatches, cancellation and persisted update provenance.

Pending: actual public-repository installation, installed native app workflows,
visual/compact layout checks and a real OpenAI model/key round trip. Fixture
responses are not a substitute for these checks. No live host contents or real
credentials are included in this repository.
