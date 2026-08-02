# Two-browser recovery demo

Open `http://127.0.0.1:58080/recovery/` after starting Hestia. Choose whether
the ceremony is reusable or single-use, create an invite, and open the exact
generated URL in a second browser.

The URL fragment contains a random ceremony identifier and a 256-bit
capability. Fragments are not sent in HTTP requests. The capability
authenticates signed signalling and DataChannel envelopes locally; Hestia sees
only the room identifier, random peer identifiers, and WebRTC negotiation
messages.

Once connected, the browsers:

1. authenticate one another using capability-MACed P-256 peer identities;
2. establish an ordered WebRTC DataChannel;
3. create an encrypted P-256 identity recovery package;
4. split its recovery secret into two-of-two Shamir shares;
5. retain one AES-GCM-encrypted share in each browser's IndexedDB;
6. require an explicit click in the other browser before recovery; and
7. prove recovery by signing and verifying a fresh challenge locally.

Shares and recovery envelopes travel only through the DataChannel. The
WebSocket relay never accepts share message types, and Postgres is not used by
this demo. Each browser maintains its own hash-chained transcript.

## Two physical devices

WebCrypto requires a secure context outside loopback. Publish the Hoplite
origin through HTTPS, for example with a Cloudflare Tunnel, and set
`HESTIA_SITE_URL` to that public origin. `/recovery/` and `/signal` are served
through the same origin, so one tunnel route is sufficient for the page and
signalling.

Direct WebRTC often works on a local network without additional ICE servers.
For separate or restrictive networks, configure:

```text
HESTIA_STUN_URLS=stun:stun.example.net:3478
HESTIA_TURN_URLS=turn:turn.example.net:3478?transport=udp,turns:turn.example.net:5349?transport=tcp
HESTIA_TURN_TTL_SECONDS=600
```

When TURN URLs are set, the signalling service derives a short-lived TURN REST
username and credential from `HESTIA_TURN_SECRET`. The long-lived secret never
leaves Hestia. TURN itself cannot be carried through an HTTP tunnel: publish
its configured TCP/UDP listener and relay ports separately.

A ceremony accepts exactly two live signalling peers. A reusable ceremony
trusts the original peer fingerprint on later connections. Single-use mode
erases both encrypted shares after confirmed recovery and retains a local
consumed tombstone.
