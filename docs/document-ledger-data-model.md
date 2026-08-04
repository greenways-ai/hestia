# Document ledger data model

`hestia.document_head` contains only the current revision and AST roots.

`hestia.document_revision` is append-only and binds:

- previous revision and AST roots;
- contributor batch root;
- Hestia transformation root;
- transformed operation vector root;
- result AST root;
- author profile root;
- environment key root; and
- signed import receipt root.

`hestia.document_operation_projection` stores replay-oriented JSON alongside the
canonical operation root. Its JSON may be rebuilt or discarded.

`hestia.document_batch_admission` is the two-stage compare-and-swap staging row.
It records the exact head, profile and delegation seen during prepare and allows
commit only when they still match.
