# FIA — Fraud Intelligence Agency

> **Share the lesson. Keep the ledger.**
>
> A business-owned fraud intelligence network: private workspaces, reviewed defense packages, independent decisions, and locally runnable intelligence.

**Document:** Product and technical specification  
**Version:** 1.0  
**Date:** September 27, 2026  
**Event:** Own Your Intelligence Hackathon  
**Status:** Implementation specification; no integration, benchmark, security property, or offline capability is claimed as already implemented.  
**Working name:** FIA — Fraud Intelligence Agency. An independent business network, not a government agency. The name is a creative selection, not a trademark-clearance result.

---

## 1. Product decision

Build **one supplier-payment investigation workflow across two independently owned business workspaces**.

Northline Roasters experiences a simulated fraud loss, investigates it, derives a reusable defense, tests it, and approves publication. Harbor Print reviews and independently tests the package, applies it to a different case using its own records, trains a candidate local defender, and runs a fresh investigation after external networking is blocked. Harbor can contribute an approved correction back to the network.

The product is the controlled crossing between workspaces: **a tested procedure travels; private records and access privileges do not**.

Every new observation is a candidate contribution, not automatically useful intelligence. A contribution may improve detection, identify an exception, expose a false alarm, or invalidate an earlier procedure. Improvements require evaluation and recipient approval.

### The ownership promise

Each business controls its records, knowledge, incident history, installed procedures, model adapters, configuration, approvals, and exports. A business can stop participating in the network and continue using previously accepted capabilities locally, subject to the applicable software/model licenses.

The learning pipeline may use explicitly approved cloud services. The deployed defender must not require those services to investigate a fresh local case. **Cloud-assisted learning and offline execution are different guarantees.**

### The sponsor requirement

GBrain, Memorable, QM, River, UFO, and Superset must each produce an actual, inspectable artifact or execution result in the workflow. Logos, mock API responses, unused integrations, and a generic script relabeled as a sponsor product do not qualify.

A sponsor can be integral to creating and validating a capability without becoming a permanent network dependency for using that capability. That distinction is essential to this event's ownership theme.

---

## 2. Scope and non-goals

### Required demo slice

- Two fictional businesses: Northline Roasters (A) and Harbor Print (B).
- Separate workspace services, credentials, memories, writable storage, and approval queues.
- A synthetic supplier ledger, invoice history, message threads, and payment simulator in each workspace.
- One confirmed historical incident replay, one learned procedure, one published version, one independent import, and one unseen recipient-side investigation.
- Real sponsor-backed extraction, evaluation, review, and a River training/export attempt, with outcome evidence.
- A real local-runtime path and external-network-blocked restart test.
- One reviewed Harbor feedback proposal and a second package version if it passes the same gates.

Seed approximately 30 suppliers and six months of synthetic invoices per company when practical. Smaller fixtures are acceptable; the mechanism and isolation tests matter more than row count. No real banking, inbox, customer, or employment records are required.

### Not in this build

Real payments; live email sending; real compromised accounts; unrestricted browser/computer use; a global blacklist of companies or people; automatic cross-business memory search; shared private embeddings; federated gradient aggregation; cryptographic private-set intersection; differential-privacy claims; production financial compliance certification; universal fraud detection; a marketplace; or a million-business deployment.

The system is not a central autonomous authority. It must not force model upgrades or procedure changes into participating businesses.

### Positioning

Threat-intelligence sharing is not new: MISP already supports financial-fraud information and granular sharing [S9]. FIA's proposed contribution is the integration of reviewed intelligence, repeatable agent procedures, recipient-side evaluation, model adaptation, and independent local execution. Do not claim a world's-first invention.

---

## 3. Non-negotiable invariants

| ID | Requirement |
|---|---|
| OWN-01 | A business retains a runnable local defender and its required artifacts after network disconnection. No silent hosted-model fallback. |
| ISO-01 | An A credential, agent, tool, or writable mount cannot access B's private records, and vice versa. A shared host administrator remains a trusted demo operator, not a defeated adversary. |
| SHARE-01 | Only an explicitly reviewed defense package crosses the business-sharing boundary. A publication never grants access to the publisher's workspace. |
| CONSENT-01 | Cloud submission, publication, installation, model promotion, and simulated payment release require distinct, authenticated owner approvals bound to exact artifact versions. |
| MEMORY-01 | Incoming messages are unverified observations. They cannot directly overwrite verified supplier facts or business policy. |
| EXEC-01 | External content and imported procedures cannot authorize tools, grant permissions, change safety policy, or approve their own actions. |
| EVAL-01 | Training, validation, final tests, scoring code, prompts, and model versions are recorded. Scores come from real runs, never the mockup. |
| LOCAL-01 | Deployed inference, retrieval, procedure use, UI assets, approval checks, and queue state work without external APIs. |
| SPONSOR-01 | Each of the six sponsor contracts in Section 6 has inspectable evidence. Missing evidence is shown as incomplete. |
| HUMAN-01 | The agent may recommend or maintain a hold. It cannot release a simulated payment without the local owner's approval and required verification. |
| HONEST-01 | No claim of millions protected, money actually saved, privacy certification, or unseen attack-class generalization from this demo. |
| REVOKE-01 | Owners can deactivate packages and roll back affected model versions. Withdrawal does not remotely erase already downloaded copies. |

---

## 4. Architecture and trust boundaries

### 4.1 Logical layout

```text
NORTHLINE: private workspace                 HARBOR: private workspace
---------------------------------           ---------------------------------
Synthetic records + approved policy          Synthetic records + approved policy
          |                                            |
GBrain knowledge / incident evidence          GBrain knowledge / incident evidence
          |                                            |
UFO investigation + local model               UFO investigation + local model
          |                                            |
Approved, synthetic extraction input          Imported candidate in quarantine
          |                                            |
Memorable candidate procedure                Local acceptance tests + owner approval
          |                                            |
QM evaluation + fixed FIA scorer              Active Memorable procedure
          |                                            |
Superset versioned review dossier             Apply to a different local case
          |                                            |
Owner signs approved package                 River candidate adaptation + evaluation
          |                                            |
          +-- FIA restricted package relay -----------+
              Procedure, synthetic tests,               |
              measured report, provenance only          |
                                              Local model + accepted artifacts
                                                        |
                                              Restart; block external network
                                                        |
                                              Fresh case -> hold + local draft

REVIEWED RETURN PATH: Harbor -> revised procedure / synthetic regression test
                     -> recipient-independent release and adoption gates
```

There is no private A-to-B data arrow. The optional return path uses exactly the same publication boundary as the initial contribution.

### 4.2 Components

**Workspace service, one per company.** An FIA-owned API fronts the business's UFO instance, GBrain adapter, Memorable store, local model, simulator, and audit log. Workspace identity is derived from authenticated server context, never trusted from a request-body field.

**Restricted package relay.** A small store/distribution service holds approved package bytes, signatures, allowed-recipient identities, and withdrawal notices. It has no business-memory credentials. It may learn publication and download metadata; do not promise anonymous participation. The demo may use an authenticated local relay. Remote production transport needs independently reviewed transport security and access control.

**Learning/evaluation workbench.** QM runs synthetic scenario jobs and exports their actual results. River and Memorable receive only inputs approved for their distinct cloud boundaries. These jobs do not have direct network paths or credentials to the private company stores.

**Superset review workspace.** Source development plus versioned, sanitized review dossiers. Native comments inform revisions. FIA records the reviewed Page version and the exact package hash in its local approval receipt; a comment is not itself a payment or publication authorization.

**Presenter shell.** One screen displays two isolated workspace views and the publication arrow. The demo operator is explicitly authorized to see both fictional workspaces. The shell must not become an agent-accessible combined knowledge store. A production owner sees only their own workspace and authorized bulletins.

### 4.3 Isolation implementation

Use separate containers or equivalent OS-enforced isolation, mounts, service credentials, database files, and network segments. Never mount the host home directory, Docker socket, or both business volumes into an agent sandbox. The default UFO local carrier permits broad host reads and does not enforce egress at the kernel boundary; use a stronger configured carrier and test it [S4].

GBrain source labels alone are not the isolation mechanism: its documentation distinguishes authenticated remote grants from callers possessing local files or shared database credentials [S1].

On a single GPU, model execution may be serialized. A shared trusted model-host process is a demo resource compromise: isolate sessions/caches, disable prompt logging, and disclose that the host administrator can access both. Prefer independent inference processes or separate machines. Do not equate two browser tabs with isolation.

---

## 5. Memory: what is stored, learned, and shared

| Layer | Canonical owner/store | Examples | Update rules | May cross the business boundary? |
|---|---|---|---|---|
| Source records | Workspace ledger/message fixture store | Invoices, payment receipts, thread messages | Append source events; preserve originals | No |
| Verified knowledge | Private GBrain | Approved supplier contact, accepted account, local approval policy | Owner-confirmed source and version required | No |
| Incident experience | Private GBrain + workspace trace store | Investigation observations, verification result, owner decision | Preserve provenance and uncertainty; corrections supersede rather than rewrite history | No |
| Reusable procedures | Workspace-local Memorable store | Investigation steps, preconditions, limitations | Candidate -> validated -> approved -> active; versioned | Reviewed generalized package only |
| Procedure lineage | Private GBrain index | Active package hash, source publisher, local acceptance report | Metadata references canonical procedure bytes; not an unsynchronized second copy | Only the separately reviewed public provenance fields |
| Learned model state | Workspace model directory | Base revision, tokenizer, adapter, runtime config, evaluation report | Candidate model promoted only after acceptance | Not in the A-to-B package |
| Owner audit/permissions | Workspace database | Approvals, denials, token scope, publication recipients | Server-controlled, append-only application events | Only necessary reviewed attestations |

GBrain documents explicit facts with sources, correction/withdrawal, and a keyless retrieval starting point [S1]. Memorable documents procedure extraction and storage on the user's machine, in GBrain, or in QM storage [S2]. For the first build, use its local store and keep lineage references in GBrain; a direct shared-database backend is an optional simplification only after compatibility is tested.

### 5.1 Read path

1. UFO receives an incident ID under a fixed workspace identity.
2. The GBrain adapter retrieves that business's policy, verified supplier facts, and relevant history, with source IDs and dates.
3. Memorable recalls only locally active, version-pinned procedures. Retrieval must work with external networking blocked; disable remote semantic fallback if necessary.
4. The local model receives bounded evidence and procedure text. Raw observations are labeled untrusted; procedures do not become system-level authority.
5. FIA validates proposed actions and records the specific evidence, policy version, procedure hash, and model revision used.

### 5.2 Write path

A message claiming a bank changed creates an `unverified` observation. An independent verification result plus owner approval may create a new verified supplier fact. The old fact remains historically addressable. Agent hypotheses do not mutate approved payment records.

A confirmed incident may initiate procedural extraction, but extraction creates a draft only. Imported procedures remain quarantined until local tests and owner approval complete. Model training is a separate versioned operation, not a side effect of reading a new message.

Deletion and export must distinguish records, indexes, logs, packages, and trained adaptations. A Markdown export is not automatically a complete GBrain backup [S1]. A removed training example also does not prove its influence has been removed from an adapter; rollback or retraining may be necessary.

---

## 6. Sponsor integration contracts — required, not decorative

The named adapter methods below are **FIA interfaces to implement**, not claims about existing upstream SDK method names. Pin the upstream revisions and record them in `integration-lock.json` after installation. Documentation verification is not runtime verification.

### 6.1 GBrain — private evidence and durable knowledge

**Input:** Workspace-local supplier facts, policy, incident observations, confirmed outcomes, and package lineage.  
**Operation:** FIA's `KnowledgeStore` adapter writes sourced facts and retrieves scoped evidence during a real UFO investigation. Use a keyless/local configuration for the defender.  
**Output:** An evidence bundle with resolvable local source IDs; persisted incident and package records.  
**Required proof:** Restart, repeat an evidence query, and retrieve the same verified fact; a cross-workspace query fails. Show an actual GBrain-backed result in the case drawer.  
**Removal test:** Investigation lacks its authoritative business context; a hidden alternate JSON memory must not silently substitute.  
**Boundary:** Optional cloud retrieval/enrichment services remain disabled in offline operation. Any separately enabled cloud processing is disclosed.  
**Failure:** Mark knowledge unavailable, keep the payment held, and request human review; do not invent supplier history.

Documented basis: sourced memory, corrections, keyless retrieval, and explicit sharing/cloud boundaries [S1].

### 6.2 Memorable — convert experience into a reusable defense

**Input:** An owner-approved synthetic reconstruction of the investigation trace, containing no private identifiers or original documents.  
**Operation:** Call the documented extraction service to obtain a candidate procedure, review its content, and store approved procedure versions locally. Use real recall when Harbor plans its investigation.  
**Output:** Extracted draft, extraction receipt, stored procedure, and recall evidence for an active package.  
**Required proof:** Show the actual extraction request ID, the owner's edits, the stored version, and a local recall after restarting offline.  
**Removal test:** No extracted/recalled procedural artifact feeds recipient execution; hard-coded instructions displayed under a logo are not integration.  
**Boundary:** `POST /v1/extract` receives its submitted tool trace. Review happens before that request, not only before A shares with B.  
**Failure:** Preserve the confirmed private incident and stop publication. A manually authored procedure may demonstrate the product in a reduced build, but is not Memorable extraction.

Documented basis: tool-call extraction endpoint and local procedure storage [S2].

### 6.3 QM — adversarial and legitimate-case evaluation

**Input:** A candidate procedure, public/synthetic fixture descriptions, bounded tool schemas, and an immutable evaluator revision. No private company database grants.  
**Operation:** Extend a QM fork with an FIA evaluation board. Real QM workers propose development scenarios and execute assigned jobs; FIA freezes valid fixtures and scores actual defender runs in a separate trusted evaluator.  
**Output:** QM root/worker session IDs, case-level outputs, failure reasons, and a reproducible validation report.  
**Required proof:** At least one real worker lifecycle and its result appear in the fork's evaluation interface. Result counts reconcile to saved case records.  
**Removal test:** The release's required QM-backed validation receipt cannot be produced.  
**Boundary:** Generator workers see development cases only. Final hidden cases and labels are inaccessible to the learner/generator.  
**Failure:** Keep candidate unpublished or mark the release reduced. A plain script is a useful fallback, not a completed QM track integration.

Documented basis: QM's session-based swarms and authenticated worker operations; the FIA board and scoring are new work [S3].

### 6.4 River — recipient-owned model adaptation

**Input:** Harbor-approved, corrected synthetic trajectories, approved procedure context, and a dataset split manifest. Never Northline's raw traces or Harbor's private records.  
**Operation:** Discover models available to the event account; train one candidate adapter; evaluate it; download the resulting artifact and load it with the exact matching base locally.  
**Output:** Training receipt, dataset hash, checkpoint identity, exported adapter hash, runtime manifest, and same-model comparison report.  
**Required proof:** Real training occurred and actual adapter files are inspected and loaded locally. A remote checkpoint identifier or console screenshot alone is insufficient.  
**Removal test:** There is no sponsor-backed model adaptation/export stage; procedure-only improvement is not relabeled as training.  
**Boundary:** Cloud learning is explicit. Ownership here means the exported artifact can be used locally under the relevant terms, not that the provider never processed training inputs.  
**Failure:** Retain the last good defender. Disclose training failure, export failure, incompatibility, or lack of measured benefit separately.

River documents account-scoped model discovery and downloadable PEFT-format LoRA weights requiring the corresponding base model. A `river://` checkpoint is not a public download URL [S5, S6]. A compatible local runtime remains a deployment gate.

### 6.5 UFO — real investigation and action lifecycle

**Input:** A workspace-bound incident, local model provider, GBrain evidence tool, Memorable procedure tool, and constrained simulator tools.  
**Operation:** Implement an FIA extension for investigation and verification drafting. The UFO run must execute the actual reads and proposed actions. FIA's local authorization service gates any simulated release.  
**Output:** Durable run/turn IDs, evidence references, action proposals, approval receipts, and resulting payment-queue state.  
**Required proof:** Follow a live UFO tool call to an actual queue change; restart without losing the recorded hold.  
**Removal test:** No investigation-to-action execution path exists; a separate app secretly performing all work is not acceptable.  
**Boundary:** No arbitrary shell/network tool is needed. The model and retrieval path must stay local in the final test.  
**Failure:** Hold, record the error, and defer to the human. Do not mark a drafted request as sent or a held payment as fraud proven.

Documented basis: self-hosted runtime, workspace scope, and model/tool extension points. Default embeddings and sandbox behavior require explicit local/security configuration [S4, S4a].

### 6.6 Superset — development and human intelligence review

**Input:** The source workspace plus a sanitized candidate dossier: procedure diff, synthetic tests, measured report, limitations, and package hash.  
**Operation:** Build in Superset; publish the dossier through Pages; collect a real review comment and resolve it through a revised dossier or an explicit reason. Pin the reviewed version before local signing.  
**Output:** Development evidence, Page ID/version, review reference, and hash-bound local owner approval.  
**Required proof:** A meaningful review changes a procedure/test or records a reasoned acceptance, with version history. A landing-page screenshot alone is insufficient.  
**Removal test:** The release lacks its required review artifact and owner review trail.  
**Boundary:** Pages receives sanitized material only. Restricted packages cannot be made public for convenience. The owner approves payment and publication in FIA, not through an assumed Pages payment API.  
**Failure:** Stop that release's full-integration status. Previously installed defenses keep running without Pages.

Documented basis: HTML report publishing, versioned sharing, and comments feeding agent updates. Public readers do not automatically gain comment/edit permission [S7]. No custom Pages callback API is assumed.

### 6.7 What counts as “all sponsors integrated”

All six evidence receipts must exist and point to real outputs. A River candidate may legitimately fail the promotion gate; that demonstrates training and evaluation, not improved performance. A missing or incompatible local adapter means the full trained-offline milestone remains incomplete, even if procedure-only offline operation works.

Only GBrain, local Memorable retrieval/artifacts, UFO, FIA's local services, and the local model are needed for an already-installed defense to run offline. QM, River, Superset, the extraction API, and the relay are learning/distribution dependencies, not hidden runtime requirements.

---

## 7. The one end-to-end demo workflow

### 7.1 Northline incident: historical loss replay

Show two fictional invoices totaling $9,400 and a later thread message requesting different payment details. A historical fixture records the earlier human-approved simulated payment and subsequent independent confirmation of fraud. Clearly label the scene **“Synthetic historical incident replay”**.

Do not script a frontier or local model to fail and present the result as an observed baseline. Both evaluated defenders receive a reasonable existing checklist. If a current baseline catches the case, show that honestly and use the replay only to explain the origin of the lesson.

The suspicious request may be in follow-up correspondence, not the original invoice. Aggregation and sender/context changes are investigation signals. A payment to an old account nine days earlier is not, by itself, proof that a later bank-change claim is false. Confirmation is a separate fixture-backed human event.

The FBI's public BEC guidance recommends independently checking payment changes [S8]. FIA's safety floor therefore applies to a detected change regardless of invoice amount; a split-invoice threshold must not become an excuse to bypass that check.

### 7.2 Investigate locally

UFO reads Northline's own GBrain evidence and simulator history. The case panel shows the source chronology, identified claims, missing verification, proposed next action, and what is known versus inferred. The owner confirms the simulated incident using the provided verification outcome.

**Visible artifact:** A private incident record with evidence and confirmation, not a shareable incident transcript.

### 7.3 Learn and evaluate

Create an approved synthetic reconstruction of the task and tool outcomes. Memorable extracts a draft such as:

- Inspect payment-change claims across the full thread and approved transcribed channels.
- Reconcile related invoices using the receiving business's permitted policy window.
- Compare claimed timelines with local history, treating inconsistencies as reasons to verify.
- Verify through an established, independently selected contact/channel; keep unresolved payments paused.
- Distinguish already-verified legitimate changes from unresolved or rejected requests.

No universal 14-day window or $5,000 threshold is baked into the export. Those remain locally bound policy parameters.

QM runs the frozen synthetic validation suite. Superset presents the candidate and report for review. A real owner comment must be reflected in a revision or documented disposition. The owner then approves the exact package bytes and recipients in FIA.

**Visible artifacts:** Extraction receipt, actual validation results, Pages review version, and publication preview.

### 7.4 Publish and import

The publication preview shows every outbound file and field. The owner approves sharing with Harbor. FIA signs and publishes the immutable package to the restricted relay.

Harbor downloads it into quarantine, checks publisher trust, integrity, allowed scope, tool requirements, policy compatibility, and its own acceptance tests. Harbor's owner explicitly activates the version. Neither party queries the other's private records.

**Visible artifact:** An imported procedure with two different reports: publisher validation and Harbor acceptance. A publisher's report is not a substitute for recipient testing.

### 7.5 Harbor applies the defense

Introduce a different synthetic supplier and differently worded payment request, potentially carried by a forwarded phone-message transcript. Harbor's UFO run reads Harbor's own records, recalls the installed procedure, and identifies missing verification. It records a hold and drafts a message to the independently established contact route. The owner acknowledges the hold; any later release requires verified legitimacy and a separate owner approval.

Because a supplier mailbox may be compromised, simply replying to the same email thread is not treated as independent verification. A draft or contact instruction is not proof that a call or verification occurred.

**Visible artifact:** Harbor's source-cited findings, active procedure version, and persisted simulated payment state.

### 7.6 Harbor trains a candidate

Using corrected synthetic training trajectories, Harbor trains through River. Preserve a fixed local base revision and procedure context. Compare checklist-only, procedure-assisted, and procedure-plus-adapter variants on identical held-out cases.

Training and full evaluation happen during development. The demo replays their saved, timestamped records; do not imply a training run completed in a few seconds. Keep a weaker adapter as a rejected candidate, not the deployed version.

**Visible artifact:** Actual training/export receipt and measured comparison, including failures or no gain.

### 7.7 Disconnect and prove ownership

Stage all models, tokenizer files, procedures, stores, UI assets, configuration, and dependencies before disconnecting. Block Harbor's external egress using OS/network controls, restart its agent and local model, then inject a new case that was not present in the prior session.

Harbor must retrieve its own facts, recall its installed defense, perform a real local model call, and update its local queue. A failed external connectivity probe and local run trace accompany the result. Browser streaming UI may use loopback/local network, but not external APIs.

Offline action: hold and draft locally. Sending verification messages, obtaining new external facts, new cloud training, and receiving network updates are unavailable until reconnection.

### 7.8 The network feedback loop

Harbor discovers a benign exception or a missed variation during separate development/testing. Its owner approves a generalized correction and new synthetic regression test. Harbor publishes a child contribution referencing the original package version. Northline's owner, as maintainer of version 1, reviews and releases version 2 with contributor provenance after testing.

Both businesses decide independently whether to adopt version 2. No global auto-upgrade or automatic adapter merge occurs. A contributor can propose a revision without having authority to sign as the original publisher.

---

## 8. Defense package and controlled distribution

### 8.1 Package file layout

```text
FIA-DEF-0001/1.0.0/
  manifest.json               # identity, applicability, policy bindings, recipient scope
  procedure.json              # reviewed declarative steps and postconditions
  synthetic-tests.jsonl       # approved illustrative/regression cases, never final hidden tests
  validation-report.json      # observed results, versions, case counts, limitations
  review-attestation.json     # sanitized reviewed version/hash reference
  signature.ed25519           # binds payload digest and exact review-attestation bytes
```

The schema rejects unknown outbound fields by default. All nested free text receives review; an allowlisted filename is not sufficient sanitization. Strip original tool traces, identities, bank details, internal paths, private record IDs/hashes, private policy amounts, raw embeddings, and credentials. Synthetic fixtures use fictional identifiers with no preserved identity mapping.

Publisher identity, signing key ID, package lineage, and recipient identities are intentionally shared metadata. This is selective disclosure, not a zero-information protocol. The demo export scan includes seeded unique private canary strings, but a passing scan is not proof of comprehensive anonymization.

### 8.2 Required manifest fields

| Field | Meaning |
|---|---|
| `schema_version`, `package_id`, `version` | Stable schema and immutable defense identity |
| `publisher_key_id`, `created_at`, `review_after` | Pinned publisher trust and freshness metadata |
| `title`, `pattern_family`, `description` | Generalized problem and procedure purpose |
| `parent_package_hash`, `contributors` | Revision lineage and approved contributor attribution |
| `applicability`, `limitations` | Where the procedure may/may not apply |
| `required_tools`, `policy_bindings` | Allowlisted tools and local parameter names; no permission grants |
| `distribution` | `named_recipients`, `community`, or `public`; default named Harbor recipient |
| `files` | Relative path, media type, size, and content hash for each payload file; excludes the manifest itself, review attestation, and signature |
| `validation_summary` | Actual aggregate results and evaluation status, not embedded private evidence |
| `usage_terms` | Explicit permission to retain/use the installed artifact and rules for redistribution |

Use a reviewed cryptographic library for hashing and signing. Define `payload_digest` over the canonical manifest and its listed procedure/test/report file digests; the review attestation and signature are outside that payload to avoid circular hashes. The Pages dossier displays this payload digest. After review, FIA records the exact Page version and owner approval in `review-attestation.json`; the signature binds both the payload digest and those attestation bytes. Owner approval binds to the payload and distribution scope, and any changed payload byte invalidates that approval. A signature proves who signed those bytes, not that the procedure is safe or the tests are representative. Reject unsigned/tampered packages, unknown schemas, path traversal, archives containing executable payloads, and untrusted publisher keys.

For the MVP, pin the two companies' public keys out of band. No key-discovery, trust marketplace, or certification claim is required.

### 8.3 Publication and installation states

```text
PRIVATE INCIDENT -> CONFIRMED -> SYNTHETIC RECONSTRUCTION APPROVED
 -> EXTRACTED DRAFT -> VALIDATED -> REVIEWED -> SIGNED -> PUBLISHED

PUBLISHED -> DOWNLOADED -> QUARANTINED -> RECIPIENT TESTED
 -> OWNER APPROVED -> ACTIVE -> SUPERSEDED / DISABLED

CANDIDATE MODEL -> TRAINED -> EXPORTED -> LOCAL LOAD VERIFIED
 -> VALIDATED -> OWNER PROMOTED -> ACTIVE / REJECTED
```

Transitions are server-checked, idempotent, and audit-recorded. Missing reports or approvals block progression. A local policy update invalidates the relevant acceptance receipt and queues re-evaluation.

Withdrawal stops new authorized downloads and publishes a signed notice. Online recipients can deactivate under their own policy. Offline copies cannot receive immediate notices or be remotely erased. Show the last synchronization time and configured freshness behavior. Production revocation/key rotation needs a separate design review.

Distribution labels may later map to FIRST TLP; TLP is a communication convention, not cryptographic access enforcement [S10]. Do not invent TLP semantics or label the MVP certified.

---

## 9. Evaluation and measurable improvement

### 9.1 Dataset separation

All cases are synthetic and restricted to the payment-change workflow. Start with roughly 60 development/training cases, 30 validation cases, and 60 final cases if execution capacity permits. Each split includes both suspicious/fraudulent requests and legitimate workflows. Use smaller suites if needed and publish the exact counts; these targets are workload choices, not evidence of statistical adequacy.

Split by scenario family/template and source seed before generation expansion; near-duplicate paraphrases must not appear across splits. Final cases and expected outcomes remain outside the agent, procedure-extraction input, River dataset, published examples, and scenario-worker context.

A final case discovered during demo debugging becomes development data and must be replaced before any new final-test claim. Track dataset lineage and duplicate checks.

### 9.2 Comparison controls

Use the same base model revision, quantization, runtime, tool access, system safety policy, local fixtures, decoding settings, and execution budget across:

1. Base model + sensible existing checklist.
2. Same model + checklist + approved procedure.
3. Same model + same context + River adapter.

A frontier model may be a separate reference, not the baseline used to attribute a gain to training. Local-to-cloud inference differences must not be confounded with adapter changes. Checkpoint selection uses validation, not repeated peeks at the final test set.

The agent proposes actions, but it does not grade itself. A fixed FIA evaluator reads actual tool calls and final simulator state. The evaluator, expected verification outcomes, and scoring code are read-only and unavailable to scenario workers or model training.

### 9.3 Metrics

| Metric | Definition |
|---|---|
| Correct verification handling | Fraction of cases completing the appropriate evidence/verification path |
| Unsafe recommendations | Agent recommends release despite fixture-defined missing/failed verification |
| Unauthorized state changes | Actual simulated release without required owner/verification authorization; must remain zero |
| Unnecessary terminal holds | Legitimate cases remain blocked after all required verification has been provided |
| Evidence accuracy | Cited source IDs exist in the same workspace and support the described observation |
| Procedure compliance | Required inspection and policy-binding steps occurred where applicable |
| Tool calls / elapsed time | Measured investigation cost indicators, with hardware/runtime identified |
| Isolation/export failures | Any cross-workspace access success or disallowed information in the exported package |

An initial precautionary hold while verification is pending is not automatically a false positive. The legitimate-case evaluation includes the verification outcome and tests whether the workflow resolves correctly afterward. Holding every payment forever must fail the completion metric.

Publish numerator/denominator pairs, case-level disagreements, and hardware/configuration alongside rates. Small synthetic samples support a scoped demo, not production loss-reduction or prevalence claims. Never use the earlier illustrative scores as results.

### 9.4 Promotion gates

Before evaluation, freeze the candidate-selection criteria. The initial demo gate is: all mandatory authorization/isolation tests pass; no new critical safety failures on validation; no increase in unnecessary terminal holds; and at least one observed improvement in correct completion or a declared efficiency metric without quality regression. Otherwise keep the incumbent and label the candidate rejected/no demonstrated benefit.

For real model training, failed trajectories are not blindly treated as desirable targets. Use verified/corrected action sequences and remove ambiguous labels. If the adapter does not help beyond the procedure, report that result. A safety regression cannot be hidden behind an improved average.

A validation-passing candidate is run once against the locked final set. A critical final failure prevents promotion; further tuning requires a new final set, not optimizing repeatedly against the revealed one.

---

## 10. Local model and offline deployment contract

### 10.1 Select and pin a real compatible model

Before UI polish, inspect River's actual account capabilities and identify a model whose exact exported adapter can run on the available local hardware. River's current public catalog includes `Qwen/Qwen3.5-9B`, but access is account-specific [S6]. This is a candidate, not an assumed laptop fit.

Pin base identifier and revision, tokenizer revision, adapter format, inference runtime/version, quantization, context limit, tool-schema encoding, and dependency lockfile. Do not substitute a smaller incompatible base for the adapter's required model or assume PEFT-to-another-runtime conversion succeeds.

The simplest acceptable generation interface returns a constrained action object validated against a fixed schema. Native tool calling is not required if the same local model produces valid structured proposals and FIA executes only allowed operations. Parsing failure, timeout, or unavailable knowledge yields human review, not an invented clearance.

### 10.2 First vertical-slice gate

Prove: local model -> UFO run -> GBrain evidence lookup -> Memorable local recall -> schema-validated action -> local queue update, with external networking blocked. Test actual retrieval rather than pre-inserting the expected answer into the prompt.

Then run a small real River training/export/load test. These two gates determine whether the full all-sponsor trained-offline demo is technically feasible on the current setup. No promise of a training duration or speedup is made by this specification.

### 10.3 Owner export, distinct from shared intelligence export

**Owner backup** may contain the business's private data and stays under its control:

```text
harbor-owned-runtime/
  runtime-manifest.json
  model/                     # licensed base/tokenizer files, or exact locally staged dependencies
  adapters/                  # active/rejected versions with lineage
  gbrain-backup/             # verified complete backup; not only a Markdown export
  memorable-store/           # approved local procedures and recall indexes
  policies/                  # Harbor's policy and tool allowlist
  simulator-state/           # private local ledger/queue for this demo
  approvals-and-audit/       # protected owner records
  ui/                        # local assets; no CDN requirement
  dependency-locks/
```

Never upload an owner backup to the intelligence relay or Pages. Keys are exported only through a separate explicitly authorized protected mechanism, not bundled in a public repository or transferable defense package.

### 10.4 Network-off behavior

No hosted LLM, remote embedding/reranking, extraction, training, browser CDN, telemetry, or online license/token refresh may be required to finish the local test. Pre-download all runtime assets and configure local retrieval; UFO's documented default embedding provider is a remote integration and must be replaced or avoided on this path [S4a].

Use an actual egress rule or network disconnection, not a UI toggle. Record a failed external probe, the local request destination, a restarted session ID, the new fixture ID, and persisted queue state. The probe proves its own connection failed; the broader egress guarantee depends on the applied network policy, not the icon.

A disconnected defender cannot learn new network bulletins or complete an external verification call. Show those limitations explicitly. Any expiration/freshness policy remains locally configured and visible.

---

## 11. One-screen interface

### Layout

**Header:** FIA — Fraud Intelligence Agency; “Independent businesses. Shared defenses.” Persistent labels identify synthetic data and simulated payments. Do not use government insignia, invented certifications, or fake classification markings.

**Left lane: Northline.** Incident replay -> private investigation -> candidate procedure -> evaluation -> review -> publish.

**Center: controlled publication boundary.** One outbound artifact inspector and one package-transfer arrow. Show actual byte count, package version, scope, signature status, and recipients. A separate reviewed feedback arrow appears only when Harbor publishes a real contribution.

**Right lane: Harbor.** Quarantine -> local tests -> accept -> investigate -> train/evaluate -> offline ownership proof.

**Bottom status strip:** Each business's active model/procedure, last synchronization time, retrieval status, and actual connection mode. Sponsor badges link to evidence receipts, not promotional pages.

### Expandable box contract

Every workflow box opens a drawer containing:

- Input IDs and whether their data are private, synthetic, or published.
- Sponsor/service used and real run/request ID.
- Evidence read and memory written, visible only to the authorized workspace owner.
- Output artifact, status, elapsed time, and required approval.
- Error or missing integration evidence, including `not_run` rather than a made-up score.

Use concise case summaries in the primary screen. Do not stream unnecessary private text into a shared report or the package inspector.

### Required interactions

`Replay incident`, `Investigate`, `Confirm fixture outcome`, `Review extraction input`, `Extract procedure`, `Run validation`, `Open review dossier`, `Approve publication`, `Inspect package`, `Test import`, `Accept version`, `Run Harbor case`, `Train candidate`, `Compare results`, `Export owner runtime`, and `Run offline check`.

Disable actions whose prerequisites have not completed. All sensitive actions are enforced server-side. The offline button launches/checks a real test; it does not merely change the interface color.

The scope inspector explicitly shows what is absent: no raw invoices, no private supplier records, no credentials, and no model adapter in the business-to-business transfer.

---

## 12. Proposed FIA data and service contracts

These are interfaces for the new application, not upstream sponsor API claims. Keep implementation thin: typed objects, bounded tools, and explicit state transitions.

### 12.1 Core records

| Record | Required fields |
|---|---|
| `Incident` | ID, workspace, source refs, observed_at, status, hypotheses, confirmation_ref, owner_decision |
| `EvidenceFact` | ID, source_ref, fact_type, value, trust_state, valid_at, recorded_at, supersedes |
| `ProcedureVersion` | Package ID/hash, version, local status, policy bindings, tool requirements, local acceptance report |
| `EvaluationRun` | ID, sponsor session refs, dataset/split hashes, scorer revision, model/runtime/procedure revisions, actual case results |
| `ModelVersion` | Base/tokenizer revisions, adapter hash, training receipt, dataset lineage, validation/final reports, promotion decision |
| `Approval` | Actor, authenticated workspace, action, payload digest, policy revision, timestamp, expiry, consumption state |
| `PaymentProposal` | Payment ID, proposed action, evidence refs, expected record version, procedure/model revisions, required verification |
| `Contribution` | Parent package hash, generalized change, synthetic regression test, recipient scope, approval and review refs |

All timestamps use an unambiguous timezone. Monetary fixture calculations use integer minor units, not model-generated arithmetic or floating-point dollars.

### 12.2 Workspace-local API

| Method/path | Responsibility |
|---|---|
| `POST /api/incidents` | Add a permitted synthetic fixture/source under the authenticated workspace |
| `POST /api/incidents/{id}/investigations` | Launch the UFO-backed investigation |
| `GET /api/investigations/{id}` | Return scoped status, evidence refs, proposals, sponsor receipts |
| `POST /api/incidents/{id}/confirmations` | Record owner-reviewed fixture verification outcome |
| `POST /api/incidents/{id}/procedure-candidates` | Prepare approved extraction input and invoke Memorable |
| `POST /api/procedure-candidates/{id}/evaluations` | Start QM-backed validation |
| `POST /api/procedure-candidates/{id}/reviews` | Register sanitized Pages dossier/version and review disposition |
| `POST /api/procedure-candidates/{id}/publications` | Verify approval, sign exact content, publish to the authorized relay |
| `POST /api/imports` | Download a permitted package into quarantine; never activate automatically |
| `POST /api/imports/{id}/evaluations` | Run recipient compatibility/acceptance tests |
| `POST /api/imports/{id}/activation` | Activate the approved exact version |
| `POST /api/models/training-runs` | Submit approved synthetic examples to River |
| `POST /api/models/{id}/promotion` | Enforce local load, evaluation, and owner gates |
| `POST /api/payments/{id}/decisions` | Owner-authorized simulator decision with state-version checks |
| `POST /api/contributions` | Create a reviewed child proposal; no implicit publication |
| `GET /api/integration-evidence` | Show actual integration status without secrets |
| `POST /api/offline-checks` | Run and record the configured network-off acceptance test |

Use server-derived identity; body-supplied workspace or actor fields cannot grant authority. Scope all lookups before returning data. Require idempotency keys on actions with side effects and reject stale approvals if the content, policy, or payment state changed.

Suggested statuses: `202` for queued work, `403` for unauthorized action, `409` for stale/conflicting state, `422` for schema/policy violations, and `503` for unavailable required services. Responses must never turn an upstream error into a successful stage.

### 12.3 Model-visible tool allowlist

Only expose: read thread; fetch local policy; retrieve scoped evidence; list related invoices; recall active procedure; propose verification; draft a local message; propose/maintain a payment hold; record an investigation observation.

Never expose publish, change recipients, approve payment, alter evaluator, edit system policy, fetch another workspace, or arbitrary shell/network calls to the investigating model. Those belong to authenticated owner or controlled service operations.

### 12.4 Minimal implementation boundaries

```text
apps/console/                    # local two-lane UI and scoped drawers
apps/workspace/                  # instance-specific API and state transitions
apps/relay/                      # approved package distribution only
integrations/gbrain/             # real evidence/memory adapter
integrations/memorable/           # real extraction and local recall adapter
integrations/qm/                  # fork extension + evaluation worker integration
integrations/river/               # training, receipt, export, model manifest
integrations/ufo/                 # FIA extension + local model provider + tools
integrations/superset/            # dossier generation, review linkage, artifacts
packages/contracts/              # schemas shared by FIA services
packages/simulator/              # source fixtures and simulated payment state
packages/evaluator/              # trusted fixed scoring; no model write access
packages/publication/            # allowlist, review binding, signatures, validation
fixtures/                        # synthetic data only; held-out cases excluded from agents
acceptance/                      # isolation, egress, integrity, sponsor, workflow tests
artifacts/                       # generated proof; ignored when private or secret-bearing
spec.md
```

Use the team's existing frontend stack and UFO's extension language rather than introduce extra frameworks. A minimal local database stores FIA state; GBrain and Memorable remain the actual knowledge/procedure systems, not unused replicas.

---

## 13. Security and privacy tests

| Threat | Required control and test |
|---|---|
| Another business requests private facts | Scoped credentials, network/mount isolation, and negative API/file-access tests |
| An invoice contains agent instructions | Untrusted content cannot change tools, policy, permissions, evaluator, or verified memory |
| A published procedure contains exfiltration instructions | Declarative allowlisted steps only; reject unknown tools, code, endpoints, and attempted privilege changes |
| A malicious publisher signs bad advice | Trust pinning plus independent local tests; signature never bypasses content review |
| Source details leak in a generalized procedure | Allowlisted outbound schema, canary scan, synthetic reconstruction, human preview; no universal anonymity claim |
| External sponsor receives private data | Separate per-provider approval and sanitized-only learning inputs; record submitted artifact hash |
| Pages leaks restricted package content | Organization/private review scope, synthetic public demo dossier, no private dataset/assets/tokens |
| Model or procedure poisoning | Quarantine, held-out tests, pinned versions, no automatic promotion |
| A check succeeds, then payment details change | Version-bound approval, revalidation immediately before simulator release, idempotent transaction |
| The cloud silently serves the offline result | OS-level egress block, fresh session and fixture, local provider trace, no fallback configuration |
| Withdrawn guidance remains embedded in a model | Lineage links procedure/data versions to adapters; deactivate and roll back to a tested model |
| The UI fakes success | Source every score/status from persisted run artifacts; `not_run`/`failed` stay visible |

Do not claim that redaction, synthetic generation, signatures, or local inference alone make the system privacy-preserving in all circumstances. Real deployments need threat modeling, privacy/legal review, secure update design, hardware/host security, model leakage testing, and independent testing beyond this demo.

---

## 14. Acceptance checklist

The full demo is complete only when the relevant checks have recorded evidence. These are requirements, not current results.

### Ownership and isolation

- [ ] A and B operate with distinct service identities, storage, and private memory.
- [ ] Cross-workspace API and filesystem attempts fail in both directions.
- [ ] The relay and QM synthetic workers hold no private-workspace credentials.
- [ ] A's private canary strings do not appear in B, the relay, sponsor payloads, or review Pages.
- [ ] An owner backup restores facts, procedures, local state, and the specified model in a fresh process.

### Learning and controlled sharing

- [ ] The historical loss is labeled a synthetic replay; any live baseline result is unmodified.
- [ ] A confirmed source outcome is distinguished from suspicious evidence and model guesses.
- [ ] A real Memorable extraction produces a reviewed candidate.
- [ ] Real QM workers and actual fixed-scorer outputs produce the validation report.
- [ ] A real Superset review is bound to the content approved in FIA.
- [ ] Package tampering, unknown tools, wrong recipients, and unsigned content are rejected.
- [ ] Harbor's owner must test and approve before activation.
- [ ] Harbor applies its own policies and sources, not Northline's private rules.
- [ ] A feedback revision undergoes testing, review, signing, and independent adoption.

### Model and execution

- [ ] UFO performs the real evidence/tool workflow and its run ID resolves.
- [ ] Agent-originated release without human approval fails.
- [ ] River's actual training receipt, exported adapter, base revision, and local load result are recorded.
- [ ] The baseline/procedure/adapter comparison uses identical model/runtime conditions and held-out cases of both classes.
- [ ] Rejected or unhelpful adapters are not described as improvements.
- [ ] External networking is blocked, the agent restarts, and a new case triggers real local inference/recall.
- [ ] The offline result persists a hold/draft; it does not claim external verification or message delivery occurred.

### Presentation integrity

- [ ] Every sponsor badge opens an actual receipt or explicitly states incomplete.
- [ ] No benchmark numbers are inherited from an illustrative diagram or script.
- [ ] The submission repository and one-to-two-minute video are accessible to judges.
- [ ] Published files contain no credentials, owner backups, private records, or hidden test answers.

---

## 15. Build sequence and explicit fallback policy

### Order of work

**Gate A — prove local execution.** Implement the smallest isolated Harbor stack and one real local investigation with networking blocked. Test source access and local procedure recall before building elaborate screens.

**Gate B — prove model portability.** Obtain authorized River access, discover models, run a minimal training/export, and test the exact artifact locally. Keep the base/runtime decision fixed after this gate.

**Gate C — complete the two-workspace transfer.** Northline extraction -> QM validation -> Superset review -> signed restricted package -> Harbor quarantine/test/approval -> new case.

**Gate D — demonstrate improvement honestly.** Execute controlled comparisons, select by validation, then run the locked final suite. Add one reviewed feedback revision.

**Gate E — presentation and submission.** Attach actual receipts, record the short and extended demos, check access, and verify no secret-bearing artifacts were published.

Workstreams may proceed in parallel after shared schemas and source ownership are fixed: runtime/isolation; extraction/evaluation/training; UI/publication/review. Do not assign every sponsor a competing agent harness for the same stage. QM owns testing; UFO owns operating the business workflow.

### Reduced modes, never silent substitutions

| Problem | Honest reduced demonstration | Claim that must be removed |
|---|---|---|
| River access/export/local loading fails | Procedure-only local defender plus clearly labeled failed integration evidence | Full trained-offline six-sponsor completion |
| River adapter has no measured gain | Show candidate, evaluation, and rejection; keep incumbent active | Training improved protection |
| QM integration unavailable | Fixed local evaluator with saved results | QM-backed swarm evaluation or a completed QM extension |
| Memorable extraction unavailable | Manually authored procedure, clearly identified | Procedure learned through Memorable |
| Superset review unavailable | Local review dossier, no invented Page receipt | Completed Superset build-and-review integration |
| UFO local-provider path unavailable | Show an explicitly reduced local prototype | UFO-powered offline execution |
| Actual egress isolation not established | Connected demonstration with visible dependency list | Offline ownership proof |

A fallback is better than a broken presentation, but does not satisfy a missing sponsor contract. Never trade away truthfulness or private-workspace isolation to display an extra logo.

---

## 16. Narration and submission

### Core pitch

“FIA lets businesses share fraud defenses without opening their books to one another. Northline learned from an incident. Harbor imported only a tested procedure, checked it against its own policies, and used it with its own records. Now Harbor keeps that capability even with the network disconnected.”

### Six-minute extended walkthrough

| Segment | Focus |
|---|---|
| 0:00–0:40 | Synthetic Northline loss replay and private workspace boundary |
| 0:40–1:25 | UFO/GBrain investigation, confirmed outcome, Memorable candidate |
| 1:25–2:15 | Actual QM evaluation and Superset review; inspect allowed export |
| 2:15–3:15 | Harbor quarantines, tests, approves, and applies the package |
| 3:15–4:15 | Recorded River training/export and measured local comparison |
| 4:15–4:45 | Approved Harbor feedback and a versioned correction |
| 4:45–6:00 | Restart Harbor with external networking blocked; execute fresh case; show evidence |

This allocates narration time, not guaranteed compute duration. Use precomputed benchmark/training artifacts labeled with their actual run timestamps, and real local interactions for the final proof. Keep an actual screen recording as presentation backup; identify replayed segments honestly.

### One-to-two-minute submission cut

Problem and synthetic incident -> approved package crossing -> Harbor's own-data investigation -> short measured results view -> actual offline restart/case result. Include project name, problem, source URL, and selected side quests as required by the organizer's briefing supplied in this conversation. Do not substitute the six-minute video for the requested short submission.

### Final statement

**Northline keeps its evidence. Harbor keeps its independence. The network shares a tested method—not ownership of either business's intelligence.**

---

## 17. Evidence status and authoritative references

Primary product documentation below was reviewed while preparing this specification on September 27, 2026. No sponsor account was connected, software stack installed, local model benchmark run, adapter trained, or application implemented as part of writing this document. At implementation time, pin and record actual revisions; current docs may change.

The organizer/sponsor track requirements, event name, company fixtures, and desired narrative come from the user-provided conversation. Those statements are not independently verified eligibility rulings. Confirm any ambiguous judging requirement with the event team; do not advertise a prize qualification based only on this design.

| ID | Primary source | Documented capability used |
|---|---|---|
| S1 | GBrain repository — `https://github.com/garrytan/gbrain` | Sourced facts, corrections, keyless retrieval, ownership/sharing/cloud boundaries |
| S2 | Memorable documentation — `https://www.memorable.sh/doc` | Tool-trace extraction, local procedure storage and recall |
| S3 | QM swarm specification — `https://github.com/yc-software/qm/blob/main/docs/swarms.md` | Session workers, swarm operations, scopes, and deployment caveats |
| S4 | UFO core repository — `https://github.com/ufo-ai/ufo-core` | Self-hosted execution, workspace scope, extensions, default sandbox limitations |
| S4a | UFO core specification — `https://github.com/ufo-ai/ufo-core/blob/main/spec.md` | Model-provider and embedding extension seams |
| S5 | River operations — `https://docs.river.ai/guides/operations/` | Console downloads, PEFT LoRA export, corresponding base model requirement |
| S6 | River models/access — `https://docs.river.ai/guides/models/` | Live account capabilities and available model catalog |
| S7 | Superset Pages — `https://docs.superset.sh/pages` | Versioned HTML publishing, visibility, comments, and review workflow |
| S8 | FBI BEC guidance — `https://www.fbi.gov/how-we-can-help-you/common-frauds-and-scams/business-email-compromise` | Independent verification of payment/account changes |
| S9 | MISP features — `https://www.misp-project.org/features/` | Existing fraud/threat-intelligence sharing and granular disclosure precedent |
| S10 | FIRST TLP — `https://www.first.org/tlp/` | Established dissemination-label convention; not an FIA certification |

### Definition of success

A reviewer can inspect a real sponsor-backed learning chain, verify exactly what crossed the business boundary, observe Harbor making its own evidence-based decision, and repeat a new local investigation after disconnection. Anything beyond those observed properties remains a goal—not a shipped claim.
