----------------------- MODULE LiveChangeApprovalProtocol -----------------------
EXTENDS Naturals

CONSTANT MaxVersion
None == "NONE"
Ready == "READY"
Approved == "APPROVED"
Rejected == "REJECTED"
Operator == "OPERATOR"
Director == "DIRECTOR"

VARIABLES liveVersion, proposal, baseVersion, approver, appliedCount, appliedFromVersion
vars == <<liveVersion, proposal, baseVersion, approver, appliedCount, appliedFromVersion>>

TypeOK ==
  /\ liveVersion \in 0..MaxVersion
  /\ proposal \in {None, Ready, Approved, Rejected}
  /\ baseVersion \in 0..MaxVersion
  /\ approver \in {None, Operator, Director}
  /\ appliedCount \in 0..1
  /\ appliedFromVersion \in 0..MaxVersion

Init ==
  /\ liveVersion = 0
  /\ proposal = None
  /\ baseVersion = 0
  /\ approver = None
  /\ appliedCount = 0
  /\ appliedFromVersion = 0

Propose ==
  /\ proposal = None
  /\ proposal' = Ready
  /\ baseVersion' = liveVersion
  /\ UNCHANGED <<liveVersion, approver, appliedCount, appliedFromVersion>>

Mutate ==
  /\ liveVersion < MaxVersion
  /\ liveVersion' = liveVersion + 1
  /\ UNCHANGED <<proposal, baseVersion, approver, appliedCount, appliedFromVersion>>

ApproveByDirector ==
  /\ proposal = Ready
  /\ baseVersion = liveVersion
  /\ liveVersion < MaxVersion
  /\ proposal' = Approved
  /\ approver' = Director
  /\ appliedCount' = 1
  /\ appliedFromVersion' = liveVersion
  /\ liveVersion' = liveVersion + 1
  /\ UNCHANGED baseVersion

Reject ==
  /\ proposal = Ready
  /\ proposal' = Rejected
  /\ approver' = Director
  /\ UNCHANGED <<liveVersion, baseVersion, appliedCount, appliedFromVersion>>

Next == Propose \/ Mutate \/ ApproveByDirector \/ Reject
Spec == Init /\ [][Next]_vars

ApprovalHasDistinctActor == proposal # Approved \/ approver = Director
ApprovalAppliesExactlyOnce == proposal # Approved \/ appliedCount = 1
ApprovalUsesCurrentBase == proposal # Approved \/ appliedFromVersion = baseVersion
=============================================================================
