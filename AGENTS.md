Use `wrk` for create and updating tickets

To run the ticket script, see [docs/ticket-runner.md](docs/ticket-runner.md).

Current delivery priority (user decision, 2026-11-18): progress through feature
tickets with the working baseline. Performance budget overruns and missing
performance measurements alone do not block feature tickets. Record limitations
and defer rendering/presentation refinement to TW-049 (`wrk-6e0d23e5`) and large
edit/history/memory refinement to TW-050 (`wrk-e61b329b`). Functional correctness
and data integrity still need validation. TW-011 is accepted as a baseline under
this revised scope; its original performance gate has not passed.
