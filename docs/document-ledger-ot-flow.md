# Document OT flow

A stale signed batch is mapped through every accepted operation after its base
revision. The transformed operations are then mapped through earlier operations
in the same atomic batch. The environment signs that transformed vector before
PostgreSQL constructs the revision and import receipt.

An accepted result advances the head once. A conflict preserves the current AST,
creates no revision, and returns a signed conflict receipt.
