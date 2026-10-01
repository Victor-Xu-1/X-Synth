# Real Case Testing

Acceptance tests must use real local services. Do not replace ASKCOS, Mongo,
RabbitMQ, Redis, MCTS, RetroStar, ExpandOne, or AiZynthFinder with mocks for
acceptance.

Each target must verify:

1. task submitted through the actual route-generation entrypoint
2. history record created
3. route count recorded
4. closure status recorded
5. route families are not all identical
6. failed or unclosed tasks are not marked completed
