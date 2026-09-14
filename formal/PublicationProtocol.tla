--------------------------- MODULE PublicationProtocol ---------------------------
EXTENDS Naturals

CONSTANT MaxRevision
None == 0

VARIABLES currentRevision, approvedRevision, certificateRevision, publishedRevision
vars == <<currentRevision, approvedRevision, certificateRevision, publishedRevision>>

TypeOK ==
  /\ currentRevision \in 1..MaxRevision
  /\ approvedRevision \in 0..MaxRevision
  /\ certificateRevision \in 0..MaxRevision
  /\ publishedRevision \in 0..MaxRevision

Init ==
  /\ currentRevision = 1
  /\ approvedRevision = None
  /\ certificateRevision = None
  /\ publishedRevision = None

Edit ==
  /\ publishedRevision = None
  /\ currentRevision < MaxRevision
  /\ currentRevision' = currentRevision + 1
  /\ approvedRevision' = None
  /\ certificateRevision' = None
  /\ publishedRevision' = None

Approve ==
  /\ publishedRevision = None
  /\ approvedRevision' = currentRevision
  /\ certificateRevision' = None
  /\ UNCHANGED <<currentRevision, publishedRevision>>

Certify ==
  /\ publishedRevision = None
  /\ approvedRevision = currentRevision
  /\ certificateRevision' = currentRevision
  /\ UNCHANGED <<currentRevision, approvedRevision, publishedRevision>>

Publish ==
  /\ publishedRevision = None
  /\ approvedRevision = currentRevision
  /\ certificateRevision = currentRevision
  /\ publishedRevision' = currentRevision
  /\ UNCHANGED <<currentRevision, approvedRevision, certificateRevision>>

Next == Edit \/ Approve \/ Certify \/ Publish
Spec == Init /\ [][Next]_vars

PublishedIsCurrent == publishedRevision = None \/ publishedRevision = currentRevision
PublishedIsApproved == publishedRevision = None \/ publishedRevision = approvedRevision
PublishedIsCertified == publishedRevision = None \/ publishedRevision = certificateRevision
=============================================================================
