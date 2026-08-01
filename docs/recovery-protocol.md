# Hestia recovery protocol

Identity recovery authorises a ceremony; Shamir Secret Sharing reconstructs a
recovery secret only after that authorisation. They are separate steps.

The browser encrypts a recovery package with a random 256-bit secret and splits
that secret across independently operated keepers. A keeper never sends a
reusable plaintext share: it seals the share to the browser's ephemeral
ceremony key and signs an envelope containing the ceremony, policy hash,
expiry, keeper identity and browser-key digest.

The normal recovery result is key rotation. Restoring an old private key is an
explicit policy exception. Signalling and TURN are untrusted relays; application
signatures bind every channel and message to the ceremony.

Hestia records hashes, approvals, key rotation and accreditation state. It does
not store plaintext recovery shares or confidential identity evidence.
