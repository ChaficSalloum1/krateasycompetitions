# Event-day operations, emergencies and trust

**Krateasy Competitions research brief**  
**Research date:** 14 September 2026  
**Scope:** tournament disruption, life-safety escalation, communications, offline
operation, schedule repair, recovery and product requirements.

## Executive findings

The strongest operating model is not “AI handles any emergency.” It is a system
that keeps authority, truth and communication intact when the plan stops matching
reality.

Five findings matter most:

1. **Competition disruption and life-safety response are different systems.** A
   referee may govern a withdrawal, late match or court reassignment. A medical,
   fire, security, crowd or evacuation incident activates the venue's emergency
   plan and may transfer command to emergency services. They may share an audit
   timeline, but they must never share an ambiguous authority button.
2. **The product's signature loop should be freeze → propose → validate → approve
   → publish → communicate → observe.** A proposal is not live truth. Material
   schedule changes become effective atomically only after independent validation
   and the required human approval.
3. **Communication must carry the answer, not merely a link.** Push the time,
   court and required action; offer `/next` as recovery; maintain ambient venue
   displays and paper/PA/radio fallback. WHO guidance consistently emphasises
   early, transparent, actionable communication in plain language and through
   channels people can actually use.[1]
4. **Preparedness is a product feature.** HSE guidance calls for proportionate
   plans, named responsibilities, pre-agreed show-stop wording, tested equipment,
   exercises, evacuation/casualty arrangements, authority transfer and an
   authorised restart.[2] Those requirements should become a pre-event readiness
   gate and rehearsal—not a PDF uploaded and forgotten.
5. **Trust is demonstrated under failure.** The platform must work in degraded
   and offline modes, reject duplicate/stale commands, preserve the last known
   signed truth, restore the same authoritative state and proof hash, and leave a
   complete incident record. CISA and NIST both treat governance, procedures,
   training, redundancy, response, recovery and learning as parts of resilience,
   not optional polish.[3][4]

The defensible promise is:

> Krateasy Competitions remains controlled, explainable and recoverable when
> reality diverges from the plan—and fails safely when authority or evidence is
> missing.

## 1. Two incident systems, one history

### 1.1 Routine competition disruptions

These include:

- a match running late;
- a no-show, retirement or withdrawal;
- a court, field, lane, table or tee becoming unavailable;
- an official or equipment shortage;
- an incorrect, disputed, corrected or voided result;
- a protest or appeal;
- a notification-provider or network outage;
- downstream participants remaining unknown longer than expected.

They remain under the event director/referee's competition authority. The system
should record an observation and its source, freeze only the affected scope,
preserve completed and in-progress truth, create ranked repair options, show the
blast radius, independently validate every hard constraint, request the correct
approval, atomically activate one revision, and issue targeted old-to-new updates.

Sports rules matter during repair. The LTA's current competition regulations,
for example, state that a suspended match retains its score on resumption; the
same court should be used where practical but another may be used when necessary;
and a shortened scoring format must be applied consistently to a round and cannot
be introduced after a match has started.[5] These are useful patterns, not global
rules. The compiler must select the applicable sport, competition and governing-
body rule pack and stop for clarification when policy is absent.

### 1.2 Life-safety emergencies

These include:

- cardiac or other medical emergency;
- fire, gas leak or structural failure;
- lightning, extreme heat, wind, flooding or other severe weather;
- crowd disorder, violence or security threat;
- evacuation, shelter-in-place or venue lockdown;
- missing-child or safeguarding incident;
- a major incident for which emergency services assume command.

Schedule optimisation is subordinate. The application must expose an
unmistakable **STOPPED — SAFETY INCIDENT** state, freeze automatic publication,
show the current incident lead and authority, provide only pre-approved public
messages, record each instruction and authoriser, support communication and
printable fallback, allow explicit transfer of command, and block restart until
the authorised person records that the venue, services and staff are ready.

HSE recommends deciding in advance who can stop an event, the exact show-stop
wording, how control passes to emergency services, and how public messages and
evacuation will work. It also says restart should follow consultation with the
relevant agencies and restoration of the required staff and services.[2]

The software supports the emergency action plan. It must not replace the venue,
referee, safety lead, trained responders or emergency services.

## 2. Command, roles and authority

Every event should assign five functions before play begins:

| Function | Owns | Must not silently own |
|---|---|---|
| Incident lead | Overall incident status, objectives and command transfer | Medical diagnosis or sport-rule invention |
| Competition/referee lead | Draw, rules, scores, protests and schedule authority | Venue life-safety clearance |
| Safety/medical/venue lead | Physical safety assessment and venue emergency plan | Competition fairness policy |
| Communications lead | One approved public/participant message | Unapproved operational decisions |
| Scribe/observer | Timeline, decisions, evidence and acknowledgements | Operational command |

One person may hold several functions at a small event, but the interface should
show which authority that person is exercising. FEMA's National Incident
Management System supports common terminology, management by objectives,
incident action planning, integrated communications, accountability, unity of
command, modular organisation, resource management and explicit transfer of
command.[6] Krateasy does not need to imitate a government incident system; it
should adopt the clarity that prevents “everyone thought somebody else decided.”

Two-person approval is appropriate for a material fairness or publication change
when time permits. It must not prevent an authorised person from immediately
stopping play for safety. Emergency stop first; accountability, documentation and
any schedule repair follow.

## 3. The operational state model

A single green/red “live” flag is inadequate. Use:

| State | Meaning | Automation policy |
|---|---|---|
| **NORMAL** | Authoritative schedule and services operating | Normal commands and reminders |
| **DEGRADED** | A service/channel/resource is impaired but play continues | Surface fallback and provider health |
| **PAUSED** | Competition play temporarily suspended | Freeze affected starts; prepare options; communicate next update time |
| **STOPPED** | Safety stop or major operational stop | No automatic schedule publication; emergency plan/authority visible |
| **CANCELLED** | Authorised termination | Preserve truth; communicate; begin downstream/refund/export workflows |
| **RECOVERING** | Services or venue are being restored | Verify readiness, reconcile offline commands, prepare restart |

Each transition binds actor, role, source observation, reason, effective time,
scope, version, idempotency key and evidence. The public projection shows the
effective status and instruction, not internal speculation.

## 4. On-day response loop

### Detect and establish truth

Capture what was observed, by whom, where and when. Distinguish an unverified
report from an acknowledged incident. Avoid a free-text-only incident: the system
needs a typed category, affected resources/people/contests, severity and evidence
while preserving notes.

### Contain and freeze

Stop unsafe activity immediately. For competition disruption, freeze completed
matches, matches in progress, pinned promises and a near-term horizon. Do not
rewrite a full day to optimise away a local problem.

### Generate choices

For non-safety scheduling decisions, present a small ranked set:

- minimum moved contests;
- minimum affected participants;
- minimum total time displacement;
- minimum resource changes;
- then finish time, wait and idle time.

Show why an option was selected and why plausible alternatives failed. Report
`UNKNOWN` when the search limit is reached; never turn “not found” into
`INFEASIBLE`.

### Validate and approve

An independent boundary validates hard constraints, eligibility, dependencies,
resource calendars, rest, scoring/rule state and version freshness. The approver
sees old → new, affected people, fairness/rest deltas, finish delta, unresolved
delivery risk and the exact proof identity.

### Publish and communicate

Commit the new schedule version and outbox intents atomically. The old plan stays
authoritative until that commit. A material-change message should say:

```text
Play & Konnect update: your 14:20 match moved.
New: 14:35, Court 2. Previous: 14:20, Court Alpha.
Please be courtside by 14:25. Live details: /next
```

Every message contains what changed, who is affected, what to do now, the
effective time, authoritative location and—during an unresolved pause—the next
update time. WHO's emergency-communications guidance supports early, frequent,
transparent and actionable communication with clear calls to action.[1]

### Observe, recover and learn

Track provider queued/accepted/delivered states separately from participant
acknowledgement or desk confirmation. Escalate failed/unreachable participants.
After recovery, reconcile offline actions, validate authoritative state, verify
service and venue readiness, record restart authority, and complete an after-
action review. NIST's 2025 SP 800-61 Rev. 3 integrates preparation, detection,
response, recovery and continuous improvement within risk management.[4]

## 5. Communication: push, pull and ambient

The observed Play & Konnect behaviour—players did not add a PWA to their home
screen and repeatedly asked the desk—is not user failure. It shows that the
system required memory and setup before delivering an urgent answer.

The resilient model is:

```text
                AUTHORITATIVE EVENT TRUTH
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       PUSH             PULL             AMBIENT
  WhatsApp/SMS/email   /next + QR       venue display
  contains the answer  pair lookup      PA/radio/paper
```

- **Push:** send time, court, opponent, arrival target and changed-from values.
- **Pull:** one memorable `/next` route; remember the opaque participant token;
  provide a visible “Not my pair” recovery.
- **Ambient:** high-contrast now/called/next boards, desk lookup, court signage,
  PA/radio and printed call sheets.

CISA's emergency-communications material emphasises governance, standard
procedures, interoperable systems, training/exercises, redundancy and alternate
strategies for coverage gaps.[3] The product should therefore treat provider
failure and offline/manual fallback as expected states, not exceptional errors.

## 6. Weather readiness

Do not encode one universal heat, lightning or wind threshold. Store thresholds
and authority by venue, sport, governing policy and event. Recommended workflow:

1. Monitor an official forecast and venue observations.
2. Show thresholds, uncertainty and source freshness.
3. Precompute “lose one outdoor court,” “30-minute pause” and “move indoors”
   alternatives.
4. Let the referee/venue safety authority suspend, relocate, postpone or cancel.
5. Preserve active match scores and state.
6. Revalidate rest, fairness and dependencies before resumption.
7. Communicate even before a repair exists: “Play paused; remain in the
   clubhouse; next update 14:20.”

The Met Office offers site-specific hourly event forecasts and threshold alerts
to support operational decisions and cancellation mitigation.[7] The LTA's
extreme-weather policy leaves cancellation/suspension responsibility with the
organiser/referee and venue for public safety.[8]

## 7. Medical and venue readiness

Before an event can enter “ready,” require a venue-specific offline pack:

- emergency number and exact venue address;
- ambulance entrance, gate codes and access instructions;
- AED and first-aid locations;
- named trained responders and backups;
- emergency-services liaison;
- evacuation routes and assembly points;
- accessible evacuation arrangements;
- printed copy and last-rehearsed timestamp.

The NCAA recommends venue-specific emergency action plans that are accessible,
reviewed and rehearsed, together with readily available, maintained AEDs.[9]
The application must never diagnose, offer treatment advice, expose medical or
safeguarding details publicly, or make calling emergency services slower.

## 8. Offline, infrastructure and restore

Minimum technical requirements:

- locally cached, signed last-known public schedule and participant lookup;
- visible effective revision and last-successful-sync time;
- append-only local commands with client-generated idempotency identifiers;
- duplicate, stale, reordered and conflicting-command rejection;
- explicit reconciliation after reconnect;
- transactional schedule-version and notification-outbox publication;
- worker leases and safe retries;
- provider health and channel fallback;
- tested radio, PA, paper, spare-device and battery fallback;
- forward-only migrations and verified backup restore;
- deterministic replay to identical authoritative state and proof hashes.

Recovery is not complete when a database starts. The restored state, chain,
proof identities, commands, outbox and public projection must be verified before
traffic or event authority returns. NIST frames recovery and lessons learned as
part of the incident lifecycle, not a separate housekeeping task.[4]

## 9. Product requirements and release gates

### P0 — trusted event-day foundation

- Normal / Degraded / Paused / Stopped / Cancelled / Recovering states.
- Named incident, competition, safety, communications and scribe functions.
- Explicit command transfer and restart authority.
- One authoritative effective schedule revision.
- Freeze → propose → validate → approve → publish workflow.
- Append-only incident and command log.
- Push/pull/ambient participant communication.
- Offline schedule, emergency pack, print and manual fallback.
- Pre-event readiness checklist and tabletop rehearsal.

### P1 — signature recovery

- Ranked minimum-disruption repairs.
- Old/new comparison with rest, fairness, dependencies and finish deltas.
- Participant delivery/acknowledgement intervention queue.
- Sport-, venue- and governing-body playbooks.
- Worker-crash, duplicate-webhook, network/provider outage and stale-command
  chaos tests.

### P2 — advisory intelligence

- Forecast-triggered what-if plans.
- Historical match-duration and delay distributions.
- Recommended responses with confidence, alternatives and evidence.
- Organisational learning from after-action reviews.

AI remains advisory for safety, medical, evacuation, restart, sport-rule and
material fairness decisions.

Non-negotiable gates:

- zero hard-constraint violations;
- zero silent policy invention;
- zero lost source requirements;
- zero cross-organisation data paths;
- deterministic replay for identical versions and seeds;
- no lost or duplicated acknowledged commands;
- repairs independently validated before publication;
- restored state reproduces authoritative truth and proof hashes;
- every advertised format and scale has a named tested envelope;
- a practised manual fallback exists for every critical live dependency.

## 10. Simulated expert council

> This is a simulated council applying the advisors' published frameworks. It is
> not their actual review or endorsement.

**April Dunford:** “Emergency management platform” would be a dangerous category
claim. Position against the real alternatives: spreadsheets, WhatsApp threads,
memory and hurried manual rebuilding. The differentiated value is safe,
explainable recovery for events ordinary bracket tools cannot operate.

**Seth Godin:** the participant does not owe the organiser an app installation.
Earn attention with a timely, personal, useful instruction. Send fewer messages;
make each one actionable. The smallest viable audience is the organiser whose
complexity already produces visible pain and whose players will notice calm.

**Rory Sutherland:** the player is suffering from uncertainty, not missing data.
An arrival target, a visible live timestamp, a reliable venue board and an
old-to-new message can reduce anxiety more than a richer dashboard. Do not
automate away the desk's human reassurance; give the desk better truth and fewer
avoidable interruptions.

**Byron Sharp, dissenting:** do not make robustness so technical that nobody can
remember it. Repeat the same category entry points: create a tournament, run a
league, fix a delay, find my next match. Keep one consistent Krateasy identity
and make those actions easy to access.

The practical synthesis is broad engine capability, a narrow first promise, and
proof through real operating evidence: **plan with confidence, recover without
chaos, keep every participant informed.**

## Sources

[1] World Health Organization, [Emergency communication
principles](https://www.who.int/about/communications/actionable/emergencies),
accessed 14 September 2026; WHO, [Risk communication and community engagement
readiness and response toolkit: mass gatherings](https://www.who.int/publications/i/item/9789240109148),
2025.

[2] UK Health and Safety Executive, [Planning for incidents and
emergencies](https://www.hse.gov.uk/event-safety/incidents-and-emergencies.htm),
accessed 14 September 2026.

[3] US Cybersecurity and Infrastructure Security Agency, [Emergency
communications guidance documents and publications](https://www.cisa.gov/emergency-communications-guidance-documents-and-publications),
accessed 14 September 2026.

[4] US National Institute of Standards and Technology, [Incident Response
Recommendations and Considerations for Cybersecurity Risk Management: CSF 2.0
Community Profile, SP 800-61 Rev. 3](https://www.nist.gov/publications/incident-response-recommendations-and-considerations-cybersecurity-risk-management-csf),
April 2025; NIST, [Incident response project](https://csrc.nist.gov/projects/incident-response),
accessed 14 September 2026.

[5] Lawn Tennis Association, [LTA Competition Regulations
2026](https://www.lta.org.uk/siteassets/lta-officials/my-resources/rules-and-regulations/lta-competition/lta-competition-regulations-2026.pdf),
2026.

[6] US Federal Emergency Management Agency, [NIMS management
characteristics](https://emilms.fema.gov/_is0700b/groups/330.html), accessed 14
September 2026.

[7] UK Met Office, [Event-management weather
services](https://www.metoffice.gov.uk/services/business-industry/event-management),
accessed 14 September 2026.

[8] Lawn Tennis Association, [Extreme Weather
Policy](https://www.lta.org.uk/496f08/siteassets/roles/officials/files/regulations/extreme-weather-policy.pdf),
accessed 14 September 2026.

[9] NCAA, [Cardiac health and emergency action
plans](https://www.ncaa.org/what-we-do/health-safety-and-performance/cardiac-health/),
accessed 14 September 2026.
