# Document ledger threat model

The implementation rejects:

- operation JSON that does not reconstruct the signed operation-vector root;
- batch signatures from keys without current `document.edit` delegation;
- transformation records not signed by the active Hestia environment key;
- stale prepare results after another revision advances the head;
- source snapshots for Hara artefacts whose source changed after the batch base;
- competing artefact result roots;
- cross-domain substitution between GWDP1 and GWAR1 records;
- direct application-role mutation of revisions or operation history; and
- environment signatures over browser-provided receipt bytes.

A compromised authorized editor can submit malicious edits within its mandate,
but cannot forge another contributor, rewrite accepted history, or obtain an
environment receipt for a different root without the environment key.
