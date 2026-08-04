# Hestia formal negotiation admission

Status: implementation design 0.1.0

Formal negotiation advances the room activity head. Conversation is not contract
state. An offer, counteroffer, human approval and acceptance are separate signed
canonical records with independently verified authority.

The intended key split is:

```text
propose / counter     admitted operational key
human approve         admitted profile root key
accept                 admitted operational key + exact approved offer root
```

A human-required room cannot accept an offer from an operational signature
alone. The acceptance must reference a separately admitted root-key approval
record that binds the exact offer signed-record root.
