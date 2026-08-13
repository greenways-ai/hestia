# Hestia authority vocabulary

Hestia is the canonical authority for shared private-room activity. It is not a
general authentication service for every local Greenways operation.

The Greenways-wide vocabulary distinguishes:

- **verification**: signatures, roots and canonical records are valid;
- **authentication**: a live caller is bound to an enrolled identity;
- **approval**: a human accepts one exact subject root;
- **grant**: a signed delegation names an exact subject and bounded operations;
- **authorization decision**: current membership, mandates, grants, approval,
  validity and revocation produce allow or deny;
- **admission**: a verified canonical record is accepted into Hestia governance;
- **resource scope**: Tahto proves data is reachable within an exact namespace;
  and
- **resource ownership**: a provider owns an opaque handle for finite host work.

## Hestia ownership

Hestia owns room records, membership epochs, source mandates, room application
grants, exact-root approvals, revocations and authority receipts. Its allowed
decision retains the exact canonical roots supporting the decision.

Hestia does not:

- approve installation of a local application;
- issue `greenwaysd` capability grants or local-client roles;
- grant a Tahto object to an application namespace;
- verify object bytes or canonical HTA; or
- own provider credentials, browser cookies or native resource handles.

Greenways OS composes an active Hestia room decision with its independent local
application approval and capability decision. Tahto may consume the resulting
request-bound authority proof, but it cannot create or widen Hestia authority.

## Admission versus authorization

Hestia record admission validates and commits a signed governance transition.
Runtime authorization evaluates the currently admitted records at an explicit
observation time. Successfully admitting a membership, mandate or grant does
not by itself authorize a different application, operation, epoch or subject
root.

