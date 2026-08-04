# Document ledger API

## Import a signed batch

```http
POST /agent/v1/documents/imports
Content-Type: application/json
```

```json
{
  "batch": {
    "record": {
      "protocol": "greenways-document-hcv1/1",
      "version": 1,
      "type": "document/batch",
      "root": "sha256:…",
      "body_root": "sha256:…",
      "signature": "…",
      "hcp1_pack": "HCP1:…"
    },
    "documentId": "019…",
    "batchId": "019…",
    "baseRevision": 4,
    "baseAst": {},
    "expectedResultAst": {},
    "operations": []
  }
}
```

The JSON AST and operations are replay projections. The gateway reconstructs
their HCV1 roots and rejects the request before OT if they do not match the
signed batch record.

Accepted response:

```json
{
  "ok": true,
  "protocol": "hestia-document-http/1",
  "document_id": "019…",
  "outcome": "accepted",
  "sequence": "12",
  "revision": "5",
  "revision_root": "sha256:…",
  "result_ast_root": "sha256:…",
  "receipt_root": "sha256:…",
  "signed_receipt_root": "sha256:…",
  "transformation_root": "sha256:…",
  "environment_signature": "…",
  "conflict": null
}
```

A conflict uses the same signed response shape with `outcome: "conflict"` and
`revision: null`. The document head is unchanged.

The browser helper is `admitDocumentBatch` from
`@greenways/hestia-browser/document-gateway`.
