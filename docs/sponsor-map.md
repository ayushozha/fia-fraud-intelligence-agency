# Screen ↔ sponsor map

Tracks which sponsor or local FIA service backs each UI element, and whether it is live today. Update this whenever a screen or integration changes.

Legend: **Live** = real data from a running service · **Probe** = real status check, no sponsor run yet · **Showcase** = illustrative value from `apps/console/public/showcase.json` (only in Showcase mode, labeled on screen)

## Network screen (`/`)

| Element | Backed by | State |
|---|---|---|
| Workspace cards: name, alert pill, records | FIA workspace service (per company, isolated) | Live |
| Agent status: Maya | GBrain (private memory) — one keyless PGLite brain per workspace via `gbrain serve --surface verbs` (MCP stdio) | **Live** |
| Agent status: Jordan | UFO (workflow) | Probe — client logged in |
| Agent status: Lena, Chris | FIA local payment queue / ledger | Live |
| Replay incident | FIA simulator fixture | Live |
| Center boundary / package count | FIA restricted relay | Live (0 packages) |
| Sponsor strip | `integrations/probes.ts` + workspace receipts | Probe; green only with a receipt |

## Workspace screen (`/workspace/:id`)

| Element | Backed by | Live mode | Showcase mode |
|---|---|---|---|
| Businesses in network | FIA relay participants | Live (2) | Showcase (1,429) |
| Threats detected | FIA incidents in workspace | Live | Showcase (312) |
| Threats blocked | FIA simulated payment holds (UFO proposes, owner approves) | Live | Showcase (267) |
| Shared defenses | Signed packages on FIA relay (Memorable procedure + QM report + Superset review) | Live | Showcase (94) |
| Private workspace card | FIA workspace service | Live | Live |
| Employee agents: Maya / Jordan / Lena / Chris | GBrain / UFO / FIA queue / FIA ledger | Live | Showcase statuses |
| Maya drawer: supplier evidence | GBrain `recall` (verified `fact` vs unverified `belief`, with fact IDs + provenance) | Live | Live |
| Network intelligence graph | FIA relay participants | Live (2 nodes) | Showcase (4 nodes incl. Summit Goods, Lumen Parts) |
| "Secure network" chip | FIA relay reachability | Live | Live |
| What businesses share / stays private | Package schema policy (spec §8) | Static policy text | Static policy text |
| Live network activity | FIA relay events + workspace audit log | Live | Showcase |
| Powered by strip | Sponsor probes + receipts | Probe | Probe (never showcased) |

## Sponsor → stage (spec §6)

| Sponsor | Stage | Integration status |
|---|---|---|
| GBrain | Private evidence + verified facts per workspace | **Integrated (Maya)**: gbrain 0.59.0.0, 62 verified facts seeded per workspace, replay messages stored as unverified `belief` observations, receipts recorded. Facts use `visibility: world` inside each brain because GBrain's MCP caller only sees world facts; isolation is the separate brain per workspace (spec §4.3). |
| Memorable | Extract procedure from approved synthetic trace | Needs `MEMORABLE_API_KEY` |
| QM | Scenario evaluation board (fork extension) | Core running at :8081; board not built |
| River | Candidate adapter training + export | Needs `RIVER_API_KEY` (Python SDK) |
| UFO | Investigation + action lifecycle | Client logged in; extension not built |
| Superset | Review dossier via Pages | CLI installed; needs `superset auth login` |
