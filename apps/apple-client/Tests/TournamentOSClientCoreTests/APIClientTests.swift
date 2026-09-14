import Foundation
import CryptoKit
import XCTest
@testable import TournamentOSClientCore

final class APIClientTests: XCTestCase {
    func testFetchPortfolioDecodesVersionedDTO() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: """
        {
          "apiVersion": "1.0",
          "items": [{"id":"t1","name":"Autumn Open","revision":3,"certificationStatus":"CERTIFIED"}]
        }
        """)

        let portfolio = try await client.fetchPortfolio()

        XCTAssertEqual(portfolio.apiVersion, "1.0")
        XCTAssertEqual(portfolio.items, [
            PortfolioTournamentDTO(id: "t1", name: "Autumn Open", revision: 3, certificationStatus: .certified)
        ])
        XCTAssertEqual(transport.lastRequest?.url?.path, "/v1/tournaments")
        XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "Accept"), "application/json")
    }

    func testFetchesBlueprintScheduleFindingsAndCertificationDTOsWithoutCompetitionLogic() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","id":"t1","name":"Open","revision":3,"certificationStatus":"CERTIFIED",
         "solverStatus":"FEASIBLE","participantCount":16,"actualContestCount":15,"scheduledContestCount":15,"actionRequired":false}
        """)
        let blueprint = try await client.fetchBlueprint(tournamentID: "t1")
        XCTAssertEqual(blueprint.solverStatus, .feasible)
        XCTAssertEqual(transport.lastRequest?.url?.path, "/v1/tournaments/t1/blueprint")

        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","tournamentID":"t1","timezone":"Europe/Athens","solverStatus":"OPTIMAL",
         "objectiveValueMinutes":90,"lowerBoundMinutes":90,"optimalityGap":0,
         "items":[{"id":"M1","resourceID":"court.1","start":"2026-09-05T10:00:00Z","end":"2026-09-05T10:30:00Z",
         "possibleEntrantIDs":["A","B"],"accessibilityLabel":"Match one"}]}
        """)
        let schedule = try await client.fetchSchedule(tournamentID: "t1")
        XCTAssertEqual(schedule.items.first?.resourceID, "court.1")
        XCTAssertEqual(transport.lastRequest?.url?.path, "/v1/tournaments/t1/schedule")

        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","tournamentID":"t1","items":[{"id":"f1","code":"T1","severity":"WARNING",
         "path":"/schedule","message":"Review","accessibilityLabel":"Warning T1","debugID":"debug-f1"}]}
        """)
        let findings = try await client.fetchFindings(tournamentID: "t1")
        XCTAssertEqual(findings.items.first?.severity, .warning)

        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","tournamentID":"t1","status":"CERTIFIED","statement":"Verified",
         "certificationHash":"cert-hash","proofIDs":{"graph":"graph-hash"}}
        """)
        let certification = try await client.fetchCertification(tournamentID: "t1")
        XCTAssertEqual(certification.status, .certified)
        XCTAssertEqual(certification.proofIDs["graph"], "graph-hash")
    }

    func testFetchLiveControlRoomDecodesServerAuthoredOperationalTruth() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: """
        {
          "apiVersion":"1.0",
          "tournamentID":"t1",
          "revision":8,
          "asOf":"2026-09-05T12:05:00+03:00",
          "timezone":"Europe/Athens",
          "summary":{"now":2,"next":3,"late":1,"blocked":1,"unreported":4},
          "items":[{
            "id":"operation-M12",
            "contestID":"M12",
            "status":"LATE",
            "title":"Advanced pool · Round 3",
            "statusText":"12 minutes late",
            "detail":"Court 2 is waiting for both pairs",
            "resourceID":"Court 2",
            "scheduledStart":"2026-09-05T11:53:00+03:00",
            "participantNames":["Pair 7","Pair 11"],
            "accessibilityLabel":"Late, Advanced pool round 3, 12 minutes late, Court 2"
          }]
        }
        """)

        let operations = try await client.fetchLiveControlRoom(tournamentID: "t1")

        XCTAssertEqual(operations.summary.late, 1)
        XCTAssertEqual(operations.items.first?.status, .late)
        XCTAssertEqual(operations.items.first?.statusText, "12 minutes late")
        XCTAssertEqual(operations.items.first?.participantNames, ["Pair 7", "Pair 11"])
        XCTAssertEqual(transport.lastRequest?.url?.path, "/v1/tournaments/t1/operations")
    }

    func testRejectsUnsupportedAPIVersion() async {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: """
        {"apiVersion":"2.0","items":[]}
        """)

        await XCTAssertThrowsErrorAsync(try await client.fetchPortfolio()) { error in
            XCTAssertEqual(error as? TournamentAPIClientError,
                           .unsupportedAPIVersion(expected: "1.0", received: "2.0"))
        }
    }

    func testRejectsNonSuccessHTTPBeforeDecoding() async {
        let (client, transport) = makeClient()
        transport.respond(status: 503, json: "not-json")

        await XCTAssertThrowsErrorAsync(try await client.fetchPortfolio()) { error in
            XCTAssertEqual(error as? TournamentAPIClientError, .httpStatus(503))
        }
    }

    func testRejectsMalformedOrUnknownEnumPayloads() async {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","items":[{"id":"t1","name":"Open","revision":1,"certificationStatus":"MAYBE"}]}
        """)

        await XCTAssertThrowsErrorAsync(try await client.fetchPortfolio()) { error in
            XCTAssertEqual(error as? TournamentAPIClientError, .decodingFailed)
        }
    }

    func testRejectsPathInjectionBeforeTransport() async {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: "{}")

        await XCTAssertThrowsErrorAsync(try await client.fetchBlueprint(tournamentID: "../secret")) { error in
            XCTAssertEqual(error as? TournamentAPIClientError, .invalidURL)
        }
        XCTAssertNil(transport.lastRequest)
    }

    func testConnectedCreationReviewsServerDraftThenCompilesGuardsAndApprovesTheExactRevision() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 201, json: """
        {"apiVersion":"1.0","id":"t1","name":"Open","draftVersion":1,"revision":0,"status":"DRAFT",
         "blueprint":{},"understood":[],"questions":[],"warnings":[],"supportFindings":[],"assumptions":[],
         "compiled":null,"webPath":"/competitions/t1"}
        """)
        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","id":"t1","name":"Open","draftVersion":1,"revision":1,"status":"READY_FOR_APPROVAL",
         "blueprint":{},"understood":[],"questions":[],"warnings":[],"supportFindings":[],"assumptions":[],
         "compiled":{"guardStatus":"PASSED","requiredAcknowledgementCodes":["TSW210"]},"webPath":"/competitions/t1"}
        """)
        transport.respond(status: 200, json: """
        {"apiVersion":"1.0","id":"t1","name":"Open","draftVersion":1,"revision":1,"status":"PUBLISHED",
         "blueprint":{},"understood":[],"questions":[],"warnings":[],"supportFindings":[],"assumptions":[],
         "compiled":{"guardStatus":"PASSED","requiredAcknowledgementCodes":["TSW210"]},"webPath":"/competitions/t1"}
        """)
        let input = CompetitionCreationInput(
            name: "Open", sport: "padel", participantUnit: "pairs", participantCount: 47,
            resourceCount: 7, resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4,
            qualifiersPerPool: 1, minimumMatches: 3, minimumRestMinutes: 0,
            matchDurationMinutes: 30, startsAt: "2026-10-03T09:00:00Z",
            endsAt: "2026-10-03T17:00:00Z", priority: "finish_on_time"
        )

        let approved = try await client.createApprovedCompetition(.quick(input))

        XCTAssertEqual(approved.status, "PUBLISHED")
        XCTAssertEqual(approved.revision, 1)
        XCTAssertEqual(approved.webPath, "/competitions/t1")
        XCTAssertEqual(transport.allRequests.map { $0.url?.path }, [
            "/v1/competition-journey", "/v1/competition-journey/t1/compile", "/v1/competition-journey/t1/approve",
        ])
        let approvalBody = try XCTUnwrap(transport.allRequestBodies.last ?? nil)
        let approvalJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: approvalBody) as? [String: Any])
        XCTAssertEqual(approvalJSON["expectedRevision"] as? Int, 1)
        XCTAssertEqual(approvalJSON["acknowledgedFindingCodes"] as? [String], ["TSW210"])
        XCTAssertNil(approvalJSON["guardInput"])
    }

    func testOfflineLiveCommandTransportSendsOnlyTheExactQueuedServerCommand() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: #"{"live":{"state":{"version":8}}}"#)
        let draft = try OfflineCommandDraft.live(
            idempotencyKey: "mac.command.1",
            competitionID: "st-albans",
            publishedRevision: 1,
            expectedLiveVersion: 7,
            action: .checkIn(entrantID: "advanced.pair.1")
        )
        let envelope = OfflineCommandEnvelope(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000010")!,
            draft: draft,
            createdAt: Date(timeIntervalSince1970: 1_788_600_000)
        )

        let receipt = try await client.submit(envelope)

        XCTAssertEqual(receipt.aggregateVersion, 8)
        XCTAssertEqual(transport.lastRequest?.url?.path, "/v1/competition-journey/st-albans/live-command")
        let body = try XCTUnwrap(transport.allRequestBodies.last ?? nil)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["expectedRevision"] as? Int, 1)
        let command = try XCTUnwrap(object["command"] as? [String: Any])
        XCTAssertEqual(command["kind"] as? String, "CHECK_IN")
        XCTAssertEqual(command["commandId"] as? String, "mac.command.1")
        XCTAssertEqual(command["expectedVersion"] as? Int, 7)
        XCTAssertEqual(command["entrantId"] as? String, "advanced.pair.1")
        XCTAssertNil(command["actorId"])
        XCTAssertNil(command["occurredAt"])
        XCTAssertNil(object["guardInput"])
    }

    func testOfflineLiveCommandConflictReadsTheAuthoritativeHeadInsteadOfOverwritingIt() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 400, json: #"{"error":"live_version_conflict"}"#)
        transport.respond(status: 200, json: #"{"live":{"state":{"version":9}}}"#)
        let draft = try OfflineCommandDraft.live(
            idempotencyKey: "mac.command.stale",
            competitionID: "st-albans",
            publishedRevision: 1,
            expectedLiveVersion: 7,
            action: .call(contestID: "advanced.pools.P1.R1.M1")
        )
        let envelope = OfflineCommandEnvelope(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000011")!,
            draft: draft,
            createdAt: Date(timeIntervalSince1970: 1_788_600_000)
        )

        await XCTAssertThrowsErrorAsync(try await client.submit(envelope)) { error in
            XCTAssertEqual(error as? OfflineCommandTransportError,
                           .rejected(actualAggregateVersion: 9, reason: "live_version_conflict"))
        }
        XCTAssertEqual(transport.allRequests.map { $0.url?.path }, [
            "/v1/competition-journey/st-albans/live-command",
            "/v1/competition-journey/st-albans",
        ])
    }

    func testOfflineIncidentAndStopTransportUseServerOwnedAuthorityTimeAndMessages() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 200, json: #"{"live":{"operations":{"version":1}}}"#)
        transport.respond(status: 200, json: #"{"live":{"operations":{"version":2}}}"#)
        let incident = try OfflineCommandDraft.operationalIncident(
            idempotencyKey: "mac.incident.1", competitionID: "st-albans", operationalRevision: 2,
            expectedStateVersion: 0,
            incident: OfflineOperationalIncidentAction(
                incidentID: "incident.offline.1", category: .service, severity: .major,
                acknowledgement: .acknowledged, location: "Control desk",
                summary: "Primary network unavailable.", affectedContestIDs: [],
                affectedResourceIDs: [], affectedParticipantIDs: [], evidenceRefs: ["router-alarm-1"]
            )
        )
        let stop = try OfflineCommandDraft.operationalTransition(
            idempotencyKey: "mac.stop.1", competitionID: "st-albans", operationalRevision: 2,
            expectedStateVersion: 1, targetMode: .stopped,
            reason: "Incident requires an immediate venue stop.", sourceIncidentID: "incident.offline.1",
            scope: OfflineOperationalScope(kind: .venue, ids: ["st-albans"])
        )

        let incidentReceipt = try await client.submit(OfflineCommandEnvelope(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000012")!, draft: incident,
            createdAt: Date(timeIntervalSince1970: 1_788_600_000)))
        XCTAssertEqual(incidentReceipt.aggregateVersion, 1)
        XCTAssertEqual(transport.lastRequest?.url?.path,
                       "/v1/competition-journey/st-albans/operational-incident")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(
            with: try XCTUnwrap(transport.allRequestBodies.last ?? nil)) as? [String: Any])
        XCTAssertEqual(object["expectedOperationalRevision"] as? Int, 2)
        XCTAssertEqual(object["expectedStateVersion"] as? Int, 0)
        XCTAssertEqual(object["category"] as? String, "SERVICE")
        XCTAssertNil(object["actorId"])
        XCTAssertNil(object["occurredAt"])

        let stopReceipt = try await client.submit(OfflineCommandEnvelope(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000013")!, draft: stop,
            createdAt: Date(timeIntervalSince1970: 1_788_600_001)))
        XCTAssertEqual(stopReceipt.aggregateVersion, 2)
        XCTAssertEqual(transport.lastRequest?.url?.path,
                       "/v1/competition-journey/st-albans/operational-transition")
        object = try XCTUnwrap(JSONSerialization.jsonObject(
            with: try XCTUnwrap(transport.allRequestBodies.last ?? nil)) as? [String: Any])
        XCTAssertEqual(object["targetMode"] as? String, "STOPPED")
        XCTAssertNil(object["actorId"])
        XCTAssertNil(object["occurredAt"])
        XCTAssertNil(object["publicMessageCode"])
        XCTAssertNil(object["nextUpdateAt"])
    }

    func testOfflineOperationalConflictReadsTheOperationalHead() async throws {
        let (client, transport) = makeClient()
        transport.respond(status: 400, json: #"{"error":"operational_command_rejected:STALE_STATE_VERSION"}"#)
        transport.respond(status: 200, json: #"{"live":{"state":{"version":21},"operations":{"version":5}}}"#)
        let draft = try OfflineCommandDraft.operationalIncident(
            idempotencyKey: "mac.incident.stale", competitionID: "st-albans", operationalRevision: 2,
            expectedStateVersion: 1,
            incident: OfflineOperationalIncidentAction(
                incidentID: "incident.stale", category: .resource, severity: .minor,
                acknowledgement: .unverified, location: "Court 4", summary: "Net post needs inspection.",
                affectedContestIDs: [], affectedResourceIDs: ["Court 4"], affectedParticipantIDs: [], evidenceRefs: []
            )
        )

        await XCTAssertThrowsErrorAsync(try await client.submit(OfflineCommandEnvelope(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000014")!, draft: draft,
            createdAt: Date(timeIntervalSince1970: 1_788_600_000)))) { error in
            XCTAssertEqual(error as? OfflineCommandTransportError,
                           .rejected(actualAggregateVersion: 5,
                                     reason: "operational_command_rejected:STALE_STATE_VERSION"))
        }
    }

    func testOfflineEventPackIsVerifiedAgainstPinnedTrustAndRequestContainsOnlyRevisionIdentityAndExpiry() async throws {
        let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 9, count: 32))
        let payload = Data(#"{"schemaVersion":"1.0.0","organizationId":"org.st-albans","competitionId":"st-albans","competitionName":"St Albans","publishedRevision":1,"operationalRevision":2,"liveVersion":8,"generatedAt":"2026-09-20T13:00:00.000Z","expiresAt":"2026-09-20T21:00:00.000Z","timezone":"Europe/London","authority":{"publicationCertificateHash":"cert","definitionHash":"definition","guardReportHash":"guard","stateProofHash":"state","operationalStateProofHash":"operations-proof"},"operation":{"mode":"STOPPED","stateVersion":2,"instruction":"Play is stopped. Follow venue staff instructions and await the next update.","effectiveAt":"2026-09-20T13:01:00.000Z","nextUpdateAt":"2026-09-20T13:10:00.000Z","stateProofHash":"operations-proof"},"publicProjection":{"publishedRevision":1,"operationalRevision":2,"operation":{"mode":"STOPPED","stateVersion":2,"instruction":"Play is stopped. Follow venue staff instructions and await the next update.","effectiveAt":"2026-09-20T13:01:00.000Z","nextUpdateAt":"2026-09-20T13:10:00.000Z","stateProofHash":"operations-proof"},"contests":[{"contestId":"M1","participantNames":["Pair 1","Pair 2"],"court":"Court 1","startsAt":"2026-09-20T14:00:00.000Z","status":"SCHEDULED","revision":2,"projectionHash":"contest-hash"}],"projectionHash":"public-hash"},"participantLookup":[{"participantId":"pair.1","projection":{"participant":{"displayName":"Pair 1","status":"CHECKED_IN"},"operation":{"mode":"STOPPED","stateVersion":2,"instruction":"Play is stopped. Follow venue staff instructions and await the next update.","effectiveAt":"2026-09-20T13:01:00.000Z","nextUpdateAt":"2026-09-20T13:10:00.000Z","stateProofHash":"operations-proof"},"revision":2,"next":{"contestId":"M1","opponent":"Pair 2","court":"Court 1","reportingTime":"2026-09-20T13:50:00.000Z","startsAt":"2026-09-20T14:00:00.000Z","status":"SCHEDULED"},"projectionHash":"participant-hash"}}],"emergencyReadiness":{"status":"BLOCKED_MISSING_AUTHORITY_DATA","missingDecisionCodes":["VENUE_ADDRESS"],"emergencyContacts":[],"instructions":[]}}"#.utf8)
        let publicKey = privateKey.publicKey.rawRepresentation
        let keyID = "sha256:\(SHA256.hash(data: publicKey).map { String(format: "%02x", $0) }.joined())"
        let signature = try privateKey.signature(for: payload)
        let response = SignedOfflineEventPackDTO(apiVersion: "1.0", algorithm: "Ed25519", keyId: keyID,
            publicKeyBase64: publicKey.base64EncodedString(), payloadBase64: payload.base64EncodedString(),
            signatureBase64: signature.base64EncodedString())
        let (client, transport) = makeClient(trustedOfflinePackPublicKey: publicKey)
        transport.respond(status: 200, json: String(data: try JSONEncoder().encode(response), encoding: .utf8)!)

        let pack = try await client.fetchOfflineEventPack(competitionID: "st-albans", organizationID: "org.st-albans",
            expectedPublishedRevision: 1, expectedOperationalRevision: 2,
            expiresAt: "2026-09-20T21:00:00.000Z",
            now: ISO8601DateFormatter().date(from: "2026-09-20T13:30:00Z")!)

        XCTAssertEqual(pack.body.liveVersion, 8)
        XCTAssertEqual(pack.body.operation.mode, .stopped)
        XCTAssertEqual(pack.body.operation.stateVersion, 2)
        XCTAssertEqual(pack.body.publicProjection.contests.count, 1)
        XCTAssertEqual(pack.body.participantLookup.first?.projection.next?.court, "Court 1")
        XCTAssertEqual(pack.body.emergencyReadiness.status, "BLOCKED_MISSING_AUTHORITY_DATA")
        XCTAssertEqual(transport.lastRequest?.url?.path, "/v1/competition-journey/st-albans/offline-pack")
        let requestBody = try XCTUnwrap(transport.allRequestBodies.last ?? nil)
        let command = try XCTUnwrap(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
        XCTAssertEqual(Set(command.keys), ["expectedPublishedRevision", "expectedOperationalRevision", "expiresAt"])
    }

    func testOfflineEventPackFailsClosedForTamperingWrongTrustScopeRevisionAndExpiry() throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let payload = Data(#"{"schemaVersion":"1.0.0","organizationId":"org.alpha","competitionId":"event.1","competitionName":"Event","publishedRevision":1,"operationalRevision":1,"liveVersion":0,"generatedAt":"2026-09-20T13:00:00.000Z","expiresAt":"2026-09-20T14:00:00.000Z","timezone":"UTC","authority":{"publicationCertificateHash":"c","definitionHash":"d","guardReportHash":"g","stateProofHash":"s","operationalStateProofHash":"o"},"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"o"},"publicProjection":{"publishedRevision":1,"operationalRevision":1,"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"o"},"contests":[],"projectionHash":"p"},"participantLookup":[],"emergencyReadiness":{"status":"BLOCKED_MISSING_AUTHORITY_DATA","missingDecisionCodes":[],"emergencyContacts":[],"instructions":[]}}"#.utf8)
        let key = privateKey.publicKey.rawRepresentation
        let envelope = SignedOfflineEventPackDTO(apiVersion: "1.0", algorithm: "Ed25519",
            keyId: "sha256:\(SHA256.hash(data: key).map { String(format: "%02x", $0) }.joined())",
            publicKeyBase64: key.base64EncodedString(), payloadBase64: payload.base64EncodedString(),
            signatureBase64: (try privateKey.signature(for: payload)).base64EncodedString())
        let verifier = OfflineEventPackVerifier(trustedPublicKey: key)
        let now = ISO8601DateFormatter().date(from: "2026-09-20T13:30:00Z")!
        XCTAssertNoThrow(try verifier.verify(envelope, organizationID: "org.alpha", competitionID: "event.1",
            publishedRevision: 1, operationalRevision: 1, now: now))
        XCTAssertThrowsError(try verifier.verify(envelope, organizationID: "org.beta", competitionID: "event.1",
            publishedRevision: 1, operationalRevision: 1, now: now))
        XCTAssertThrowsError(try verifier.verify(envelope, organizationID: "org.alpha", competitionID: "event.1",
            publishedRevision: 1, operationalRevision: 2, now: now))
        XCTAssertThrowsError(try OfflineEventPackVerifier(trustedPublicKey: Data(repeating: 2, count: 32)).verify(
            envelope, organizationID: "org.alpha", competitionID: "event.1", publishedRevision: 1,
            operationalRevision: 1, now: now))
        XCTAssertThrowsError(try verifier.verify(SignedOfflineEventPackDTO(apiVersion: envelope.apiVersion,
            algorithm: envelope.algorithm, keyId: envelope.keyId, publicKeyBase64: envelope.publicKeyBase64,
            payloadBase64: envelope.payloadBase64, signatureBase64: Data(repeating: 0, count: 64).base64EncodedString()),
            organizationID: "org.alpha", competitionID: "event.1", publishedRevision: 1,
            operationalRevision: 1, now: now))
        let expired = ISO8601DateFormatter().date(from: "2026-09-20T14:00:00Z")!
        XCTAssertThrowsError(try verifier.verify(envelope, organizationID: "org.alpha", competitionID: "event.1",
            publishedRevision: 1, operationalRevision: 1, now: expired))
    }

    func testOfflinePackVersionOnePointOneRequiresBoundManualFallbackMaterials() throws {
        let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 13, count: 32))
        let payload = Data(#"{"schemaVersion":"1.1.0","organizationId":"org.alpha","competitionId":"event.1","competitionName":"Event","publishedRevision":1,"operationalRevision":1,"liveVersion":0,"generatedAt":"2026-09-20T13:00:00.000Z","expiresAt":"2026-09-20T14:00:00.000Z","timezone":"UTC","authority":{"publicationCertificateHash":"c","definitionHash":"d","guardReportHash":"g","stateProofHash":"s","operationalStateProofHash":"o","manualFallbackHash":"manual-hash"},"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"o"},"publicProjection":{"publishedRevision":1,"operationalRevision":1,"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"o"},"contests":[],"projectionHash":"p"},"participantLookup":[],"manualFallback":{"schemaVersion":"1.0.0","status":"OPERATIONAL_MATERIALS_READY_SAFETY_AUTHORITY_BLOCKED","classification":"ORGANISER_CONTROLLED_EVENT_DAY_MATERIAL","competitionId":"event.1","publishedRevision":1,"operationalRevision":1,"generatedAt":"2026-09-20T13:00:00.000Z","expiresAt":"2026-09-20T14:00:00.000Z","schedule":{"fixtureCount":0,"fixtures":[],"scheduleProjectionHash":"schedule"},"courtSheets":[],"scoreSheets":[],"participantQrIndex":{"status":"BLOCKED_PARTICIPANT_SIGNING_NOT_CONFIGURED","classification":"INDIVIDUAL_EXPIRING_ACCESS_DISTRIBUTE_SEPARATELY","entries":[],"indexHash":"index"},"restoration":{"steps":["1","2","3","4","5","6","7"],"evidenceFields":["COMMAND_ID"],"truthReferenceHash":"truth"},"packHash":"manual-hash"},"emergencyReadiness":{"status":"BLOCKED_MISSING_AUTHORITY_DATA","missingDecisionCodes":["VENUE_ADDRESS"],"emergencyContacts":[],"instructions":[]}}"#.utf8)
        let publicKey = privateKey.publicKey.rawRepresentation
        let envelope = SignedOfflineEventPackDTO(apiVersion: "1.0", algorithm: "Ed25519",
            keyId: "sha256:\(SHA256.hash(data: publicKey).map { String(format: "%02x", $0) }.joined())",
            publicKeyBase64: publicKey.base64EncodedString(), payloadBase64: payload.base64EncodedString(),
            signatureBase64: (try privateKey.signature(for: payload)).base64EncodedString())
        let verifier = OfflineEventPackVerifier(trustedPublicKey: publicKey)

        let verified = try verifier.verify(envelope, organizationID: "org.alpha", competitionID: "event.1",
            publishedRevision: 1, operationalRevision: 1,
            now: ISO8601DateFormatter().date(from: "2026-09-20T13:30:00Z")!)

        XCTAssertEqual(verified.body.manualFallback?.scoreSheets.count, 0)
        XCTAssertEqual(verified.body.authority.manualFallbackHash, "manual-hash")
    }

    func testManualFallbackURLContainsOnlyValidatedCompetitionAndRevisionIdentity() throws {
        let (client, _) = makeClient()

        let url = try client.manualFallbackURL(competitionID: "st-albans", publishedRevision: 1,
                                               operationalRevision: 2)

        XCTAssertEqual(url.path, "/v1/competition-journey/st-albans/manual-pack")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                       [URLQueryItem(name: "published", value: "1"),
                        URLQueryItem(name: "operational", value: "2")])
        XCTAssertThrowsError(try client.manualFallbackURL(competitionID: "../other", publishedRevision: 1,
                                                          operationalRevision: 2))
        XCTAssertThrowsError(try client.manualFallbackURL(competitionID: "st-albans", publishedRevision: 2,
                                                          operationalRevision: 1))
    }
}

private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ verify: (Error) -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {
        verify(error)
    }
}

private func makeClient(trustedOfflinePackPublicKey: Data? = nil) -> (URLSessionTournamentAPIClient, StubTransport) {
    let transport = StubTransport()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    StubURLProtocol.transport = transport
    let session = URLSession(configuration: configuration)
    return (URLSessionTournamentAPIClient(baseURL: URL(string: "https://example.test")!, session: session,
                                           trustedOfflinePackPublicKey: trustedOfflinePackPublicKey), transport)
}

private final class StubTransport: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [(Int, Data)] = []
    private var requests: [URLRequest] = []
    private var requestBodies: [Data?] = []

    var lastRequest: URLRequest? { lock.withLock { requests.last } }
    var allRequests: [URLRequest] { lock.withLock { requests } }
    var allRequestBodies: [Data?] { lock.withLock { requestBodies } }

    func respond(status: Int, json: String) {
        lock.withLock { responses.append((status, Data(json.utf8))) }
    }

    func handle(_ request: URLRequest) -> (HTTPURLResponse, Data) {
        lock.withLock {
            requests.append(request)
            requestBodies.append(Self.bodyData(request))
            let response = responses.isEmpty ? (500, Data()) : responses.removeFirst()
            return (HTTPURLResponse(url: request.url!, statusCode: response.0, httpVersion: nil,
                                    headerFields: ["Content-Type": "application/json"])!, response.1)
        }
    }

    private static func bodyData(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var transport: StubTransport?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let transport = Self.transport else { return }
        let (response, data) = transport.handle(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
