------------------------ MODULE IdempotentCommandProtocol ------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Keys, Fingerprints
None == "NONE"

VARIABLES fingerprint, effects, conflicts
vars == <<fingerprint, effects, conflicts>>

TypeOK ==
  /\ fingerprint \in [Keys -> Fingerprints \cup {None}]
  /\ effects \in [Keys -> 0..1]
  /\ conflicts \subseteq Keys

Init ==
  /\ fingerprint = [key \in Keys |-> None]
  /\ effects = [key \in Keys |-> 0]
  /\ conflicts = {}

Submit(key, value) ==
  IF fingerprint[key] = None THEN
    /\ fingerprint' = [fingerprint EXCEPT ![key] = value]
    /\ effects' = [effects EXCEPT ![key] = 1]
    /\ UNCHANGED conflicts
  ELSE IF fingerprint[key] = value THEN
    UNCHANGED vars
  ELSE
    /\ conflicts' = conflicts \cup {key}
    /\ UNCHANGED <<fingerprint, effects>>

Next == \E key \in Keys, value \in Fingerprints: Submit(key, value)
Spec == Init /\ [][Next]_vars

EffectAtMostOnce == \A key \in Keys: effects[key] <= 1
EffectRequiresFingerprint == \A key \in Keys: effects[key] = 0 \/ fingerprint[key] # None
=============================================================================
