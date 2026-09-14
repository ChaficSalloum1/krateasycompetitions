import XCTest
import CryptoKit
@testable import TournamentOSClientCore

@MainActor
final class AppShellTests: XCTestCase {
    func testNavigationIdentifiersAreStableAndIncludeAssociatedIdentifiers() {
        XCTAssertEqual(OrganiserSection.allCases.map(\.id), [
            "today", "operations", "event", "schedule", "participants", "competition",
            "findings", "scenarios", "certification", "settings",
        ])
        XCTAssertEqual(CompactTab.allCases.map(\.id), ["home", "run", "schedule", "people", "more"])
        XCTAssertEqual(AppRoute.scheduleItem(id: "match-7").id, "schedule-item:match-7")
        XCTAssertEqual(AppRoute.finding(id: "finding-2").id, "finding:finding-2")
        XCTAssertEqual(AppRoute.findings.id, "findings")
        XCTAssertEqual(AppRoute.operations.id, "operations")
    }

    func testEachCompactTabOwnsAnIndependentNavigationPath() {
        let model = TournamentOSAppModel(client: SuccessfulClient())

        model.pathBinding(for: .home).wrappedValue = [.schedule]
        model.pathBinding(for: .run).wrappedValue = [.finding(id: "warning-1")]
        model.pathBinding(for: .schedule).wrappedValue = [.scheduleItem(id: "match-7")]
        model.pathBinding(for: .people).wrappedValue = [.competition]

        XCTAssertEqual(model.homePath, [.schedule])
        XCTAssertEqual(model.runPath, [.finding(id: "warning-1")])
        XCTAssertEqual(model.schedulePath, [.scheduleItem(id: "match-7")])
        XCTAssertEqual(model.peoplePath, [.competition])
        XCTAssertTrue(model.morePath.isEmpty)
    }

    func testLoadingPortfolioSortsDeterministicallyAndSelectsFirstTournament() async {
        let model = TournamentOSAppModel(client: SuccessfulClient())

        await model.loadPortfolio()

        guard case .loaded(let portfolio) = model.portfolioState else {
            return XCTFail("Expected a loaded portfolio")
        }
        XCTAssertEqual(portfolio.items.map(\.id), ["alpha-upper", "alpha", "zeta"])
        XCTAssertEqual(model.selectedTournamentID, "alpha-upper")
        XCTAssertEqual(model.workspaceDestination, .portfolio)
    }

    func testOpeningAndLeavingTournamentNeverTrapsTheWorkspace() {
        let model = TournamentOSAppModel(client: SuccessfulClient())

        model.openTournament("alpha")
        XCTAssertEqual(model.workspaceDestination, .tournament)
        XCTAssertEqual(model.selectedTournamentID, "alpha")

        model.homePath = [.schedule]
        model.showPortfolio()
        XCTAssertEqual(model.workspaceDestination, .portfolio)
        XCTAssertTrue(model.homePath.isEmpty)
    }

    func testSwitchingWorkspaceClearsContextAndKeepsLocalDraftsTenantScoped() async {
        let suiteName = "TournamentOSClientCoreTests.\(UUID().uuidString)"
        let storage = UserDefaults(suiteName: suiteName)!
        defer { storage.removePersistentDomain(forName: suiteName) }
        let alpha = TournamentWorkspaceSession(
            workspace: CompetitionWorkspaceSummaryDTO(
                id: "org.alpha", name: "Alpha Club", kind: .club,
                roleName: "Owner", publicHost: "alpha.krateasy.com"
            ),
            client: SuccessfulClient()
        )
        let beta = TournamentWorkspaceSession(
            workspace: CompetitionWorkspaceSummaryDTO(
                id: "org.beta", name: "Beta League", kind: .league,
                roleName: "Director", publicHost: "beta.krateasy.com"
            ),
            client: SuccessfulClient()
        )
        let model = TournamentOSAppModel(workspaces: [beta, alpha], draftStorage: storage)
        await model.loadPortfolio()
        model.saveLocalDraft(LocalTournamentDraft(
            id: "local.alpha", name: "Alpha Sunday", clubName: "Alpha Club",
            startsAt: Date(timeIntervalSince1970: 0), sport: "Padel", participantCount: 16,
            formatName: "Pools → knockout", courtCount: 4, minimumRestMinutes: 30,
            priority: "Protect player rest"
        ))
        model.homePath = [.schedule]

        model.selectWorkspace("org.beta")

        XCTAssertEqual(model.activeWorkspace.name, "Beta League")
        XCTAssertEqual(model.workspaceDestination, .portfolio)
        XCTAssertNil(model.selectedTournamentID)
        XCTAssertTrue(model.localDrafts.isEmpty)
        XCTAssertTrue(model.homePath.isEmpty)
        guard case .idle = model.portfolioState, case .idle = model.blueprintState else {
            return XCTFail("Workspace switch must clear tenant-scoped read models")
        }

        model.selectWorkspace("org.alpha")
        XCTAssertEqual(model.localDrafts.map(\.id), ["local.alpha"])
    }

    func testCreatingLocalDraftAddsItToPortfolioAndLoadsHonestDraftState() async {
        let model = TournamentOSAppModel(client: SuccessfulClient())
        await model.loadPortfolio()
        let draft = LocalTournamentDraft(
            id: "local.test", name: "Sunday Social", clubName: "Krateasy Club",
            startsAt: Date(timeIntervalSince1970: 0), sport: "Pickleball",
            participantCount: 24, formatName: "Pools → knockout", courtCount: 4,
            minimumRestMinutes: 25, priority: "Protect player rest"
        )

        model.saveLocalDraft(draft)

        guard case .loaded(let portfolio) = model.portfolioState,
              case .loaded(let blueprint) = model.blueprintState,
              case .loaded(let certification) = model.certificationState else {
            return XCTFail("Expected a locally loaded draft")
        }
        XCTAssertTrue(portfolio.items.contains(where: { $0.id == "local.test" }))
        XCTAssertEqual(model.workspaceDestination, .tournament)
        XCTAssertEqual(blueprint.participantCount, 24)
        XCTAssertEqual(blueprint.solverStatus, .unknown)
        XCTAssertEqual(certification.status, .rejected)
        XCTAssertEqual(certification.certificationHash, "Not yet generated")
    }

    func testLoadingSelectedTournamentPublishesAllContentStatesTogether() async {
        let model = TournamentOSAppModel(client: SuccessfulClient())
        model.selectedTournamentID = "alpha"

        await model.loadSelectedTournament()

        guard case .loaded(let blueprint) = model.blueprintState,
              case .loaded(let schedule) = model.scheduleState,
              case .loaded(let operations) = model.operationsState,
              case .loaded(let findings) = model.findingsState,
              case .loaded(let certification) = model.certificationState else {
            return XCTFail("Expected all selected tournament states to be loaded")
        }
        XCTAssertEqual(blueprint.id, "alpha")
        XCTAssertEqual(schedule.tournamentID, "alpha")
        XCTAssertEqual(operations.tournamentID, "alpha")
        XCTAssertEqual(operations.summary.next, 1)
        XCTAssertEqual(findings.tournamentID, "alpha")
        XCTAssertEqual(certification.tournamentID, "alpha")
    }

    func testFailureIsFailClosedAndUsesAnActionableMessage() async {
        let model = TournamentOSAppModel(client: FailingClient())
        model.selectedTournamentID = "alpha"

        await model.loadSelectedTournament()

        assertFailure(model.blueprintState)
        assertFailure(model.scheduleState)
        assertFailure(model.operationsState)
        assertFailure(model.findingsState)
        assertFailure(model.certificationState)
    }

    func testRootShellSupportsDemoAndInjectedConstruction() {
        _ = TournamentOSAppShell()
        _ = TournamentOSAppShell(client: SuccessfulClient())
        _ = TournamentOSAppShell(model: TournamentOSAppModel(client: SuccessfulClient()))
    }

    func testDemoUsesCertifiedPadelFactsAndExposesEveryOperationalStatusInText() async throws {
        let client = DemoTournamentAPIClient()

        let blueprint = try await client.fetchBlueprint(tournamentID: "play-and-konnect")
        let schedule = try await client.fetchSchedule(tournamentID: "play-and-konnect")
        let operations = try await client.fetchLiveControlRoom(tournamentID: "play-and-konnect")

        XCTAssertEqual(blueprint.participantCount, 47)
        XCTAssertEqual(blueprint.actualContestCount, 98)
        XCTAssertEqual(blueprint.scheduledContestCount, 98)
        XCTAssertEqual(schedule.timezone, "Europe/Athens")
        XCTAssertEqual(operations.timezone, "Europe/Athens")
        XCTAssertEqual(Set(operations.items.map(\.status)), Set(LiveOperationStatusDTO.allCases))
        XCTAssertEqual(LiveOperationStatusDTO.allCases.map(\.displayName), [
            "Now", "Next", "Late", "Blocked", "Unreported",
        ])
    }

    func testConnectedMacPersistsQueuesAndAcknowledgesOneAuthoritativeLiveCommandAcrossRestart() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("krateasy-app-offline-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let client = OfflineCapableClient()
        let first = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        first.selectedTournamentID = "st-albans"
        await first.loadSelectedTournament()

        await first.queueLiveAction(.call(contestID: "advanced.pools.P1.R1.M1"))

        XCTAssertEqual(first.offlineCommands.count, 1)
        XCTAssertEqual(first.offlineCommands.first?.state, .pending)
        XCTAssertEqual(first.offlineCommands.first?.expectedAggregateVersion, 7)
        let submissionsBeforeSync = await client.submissionCount()
        XCTAssertEqual(submissionsBeforeSync, 0)

        let restarted = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        restarted.selectedTournamentID = "st-albans"
        await restarted.loadSelectedTournament()
        await restarted.loadOfflineJournal()
        XCTAssertEqual(restarted.offlineCommands.first?.state, .pending)

        await restarted.synchronizeOfflineCommands()
        XCTAssertEqual(restarted.offlineCommands.first?.state, .acknowledged)
        XCTAssertEqual(restarted.offlineCommands.first?.acknowledgement?.aggregateVersion, 8)
        let submissionsAfterSync = await client.submissionCount()
        XCTAssertEqual(submissionsAfterSync, 1)

        let finalProcess = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        finalProcess.selectedTournamentID = "st-albans"
        await finalProcess.loadSelectedTournament()
        await finalProcess.loadOfflineJournal()
        await finalProcess.synchronizeOfflineCommands()
        XCTAssertEqual(finalProcess.offlineCommands.first?.state, .acknowledged)
        let submissionsAfterRestart = await client.submissionCount()
        XCTAssertEqual(submissionsAfterRestart, 1)
    }

    func testConnectedMacVerifiesAndCachesExactOfflinePackAcrossRestart() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("krateasy-app-pack-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let client = OfflineCapableClient()
        let now = ISO8601DateFormatter().date(from: "2026-09-20T13:00:00Z")!
        let first = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        first.selectedTournamentID = "st-albans"
        await first.loadSelectedTournament()

        await first.refreshOfflineEventPack(now: now)

        XCTAssertEqual(first.offlineEventPack?.body.publishedRevision, 1)
        XCTAssertEqual(first.offlineEventPack?.body.operationalRevision, 2)
        XCTAssertEqual(first.offlineEventPack?.body.liveVersion, 7)
        XCTAssertEqual(first.offlineEventPack?.body.operation.mode, .normal)
        XCTAssertEqual(first.offlineEventPack?.body.operation.stateVersion, 0)
        XCTAssertEqual(first.offlineEventPack?.body.participantLookup.first?.projection.next?.contestId, "M1")
        let firstFetchCount = await client.packFetchCount()
        XCTAssertEqual(firstFetchCount, 1)
        let safeCompetition = "st-albans".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let cachedFile = directory.appendingPathComponent("Offline Event Packs/connected/\(safeCompetition).signed-pack.json")
        let attributes = try FileManager.default.attributesOfItem(atPath: cachedFile.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)

        let restarted = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        restarted.selectedTournamentID = "st-albans"
        await restarted.loadSelectedTournament()
        await restarted.loadOfflineEventPack(now: now.addingTimeInterval(60))
        XCTAssertEqual(restarted.offlineEventPack?.body.authority.stateProofHash, "state-proof")
        let restartedFetchCount = await client.packFetchCount()
        XCTAssertEqual(restartedFetchCount, 1, "a valid cache must not need a network fetch after restart")
    }

    func testConnectedMacDurablyCapturesOfflineIncidentAndImmediateStop() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("krateasy-app-incident-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let client = OfflineCapableClient()
        let now = ISO8601DateFormatter().date(from: "2026-09-20T13:00:00Z")!
        let model = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        model.selectedTournamentID = "st-albans"
        await model.loadSelectedTournament()
        await model.refreshOfflineEventPack(now: now)

        await model.queueOperationalIncident(
            OfflineOperationalIncidentAction(
                incidentID: "incident.mac.1", category: .service, severity: .major,
                acknowledgement: .acknowledged, location: "Control desk",
                summary: "Primary network unavailable.", affectedContestIDs: [],
                affectedResourceIDs: [], affectedParticipantIDs: [], evidenceRefs: ["router-alarm-1"]
            ),
            stopPlay: true
        )

        XCTAssertEqual(model.offlineCommands.map(\.commandName), ["RECORD_INCIDENT", "TRANSITION_MODE"])
        XCTAssertEqual(model.offlineCommands.map(\.expectedAggregateVersion), [0, 1])
        XCTAssertTrue(model.offlineCommands.allSatisfy { $0.state == .pending })
        let restarted = TournamentOSAppModel(client: client, offlineJournalDirectory: directory)
        restarted.selectedTournamentID = "st-albans"
        await restarted.loadSelectedTournament()
        await restarted.loadOfflineJournal()
        XCTAssertEqual(restarted.offlineCommands.map(\.commandName), ["RECORD_INCIDENT", "TRANSITION_MODE"])
    }

    private func assertFailure<Value>(_ state: ContentState<Value>, file: StaticString = #filePath, line: UInt = #line) {
        guard case .failed(let failure) = state else {
            return XCTFail("Expected failure state", file: file, line: line)
        }
        XCTAssertEqual(failure.message, "The server returned status 503.", file: file, line: line)
    }
}

private struct SuccessfulClient: TournamentAPIClient {
    func fetchPortfolio() async throws -> PortfolioDTO {
        PortfolioDTO(apiVersion: "1.0", items: [
            PortfolioTournamentDTO(id: "zeta", name: "Zeta Open", revision: 1, certificationStatus: .rejected),
            PortfolioTournamentDTO(id: "alpha", name: "Alpha Open", revision: 4, certificationStatus: .certified),
            PortfolioTournamentDTO(id: "alpha-upper", name: "ALPHA OPEN", revision: 3, certificationStatus: .certified),
        ])
    }

    func fetchBlueprint(tournamentID: String) async throws -> BlueprintSummaryDTO {
        BlueprintSummaryDTO(
            apiVersion: "1.0", id: tournamentID, name: "Alpha Open", revision: 4,
            certificationStatus: .certified, solverStatus: .optimal, participantCount: 32,
            actualContestCount: 62, scheduledContestCount: 62, actionRequired: false
        )
    }

    func fetchSchedule(tournamentID: String) async throws -> ScheduleDTO {
        ScheduleDTO(
            apiVersion: "1.0", tournamentID: tournamentID, timezone: "UTC", solverStatus: .optimal,
            objectiveValueMinutes: 360, lowerBoundMinutes: 360, optimalityGap: 0,
            items: [
                ScheduleItemDTO(
                    id: "match-1", resourceID: "court-1", start: "2026-09-05T09:00:00Z",
                    end: "2026-09-05T09:30:00Z", possibleEntrantIDs: ["p1", "p2"],
                    accessibilityLabel: "Match one on court one at nine"
                ),
            ]
        )
    }

    func fetchFindings(tournamentID: String) async throws -> FindingsDTO {
        FindingsDTO(apiVersion: "1.0", tournamentID: tournamentID, items: [])
    }

    func fetchLiveControlRoom(tournamentID: String) async throws -> LiveControlRoomDTO {
        LiveControlRoomDTO(
            apiVersion: "1.0", tournamentID: tournamentID, revision: 4,
            asOf: "2026-09-05T09:00:00Z", timezone: "UTC",
            summary: LiveControlRoomSummaryDTO(now: 0, next: 1, late: 0, blocked: 0, unreported: 0),
            items: []
        )
    }

    func fetchCertification(tournamentID: String) async throws -> CertificationDTO {
        CertificationDTO(
            apiVersion: "1.0", tournamentID: tournamentID, status: .certified,
            statement: "All hard invariants passed.", certificationHash: "hash", proofIDs: ["schedule": "proof-1"]
        )
    }
}

private struct FailingClient: TournamentAPIClient {
    func fetchPortfolio() async throws -> PortfolioDTO { throw TournamentAPIClientError.httpStatus(503) }
    func fetchBlueprint(tournamentID: String) async throws -> BlueprintSummaryDTO { throw TournamentAPIClientError.httpStatus(503) }
    func fetchSchedule(tournamentID: String) async throws -> ScheduleDTO { throw TournamentAPIClientError.httpStatus(503) }
    func fetchLiveControlRoom(tournamentID: String) async throws -> LiveControlRoomDTO { throw TournamentAPIClientError.httpStatus(503) }
    func fetchFindings(tournamentID: String) async throws -> FindingsDTO { throw TournamentAPIClientError.httpStatus(503) }
    func fetchCertification(tournamentID: String) async throws -> CertificationDTO { throw TournamentAPIClientError.httpStatus(503) }
}

private actor OfflineCapableClient: TournamentAPIClient, OfflineCommandTransport, OfflineEventPackClient {
    private var submissions = 0
    private var packFetches = 0
    nonisolated private static let packPrivateKey = try! Curve25519.Signing.PrivateKey(
        rawRepresentation: Data(repeating: 11, count: 32)
    )

    func submissionCount() -> Int { submissions }
    func packFetchCount() -> Int { packFetches }

    func submit(_ envelope: OfflineCommandEnvelope) throws -> OfflineCommandReceipt {
        submissions += 1
        return OfflineCommandReceipt(aggregateVersion: envelope.expectedAggregateVersion + 1)
    }

    func fetchOfflineEventPack(competitionID: String, organizationID: String, expectedPublishedRevision: Int,
                               expectedOperationalRevision: Int, expiresAt: String, now: Date) throws -> VerifiedOfflineEventPack {
        packFetches += 1
        let payload = Data("""
        {"schemaVersion":"1.0.0","organizationId":"\(organizationID)","competitionId":"\(competitionID)","competitionName":"St Albans","publishedRevision":\(expectedPublishedRevision),"operationalRevision":\(expectedOperationalRevision),"liveVersion":7,"generatedAt":"2026-09-20T13:00:00.000Z","expiresAt":"\(expiresAt)","timezone":"Europe/London","authority":{"publicationCertificateHash":"certificate","definitionHash":"definition","guardReportHash":"guard","stateProofHash":"state-proof","operationalStateProofHash":"operations-proof"},"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"operations-proof"},"publicProjection":{"publishedRevision":\(expectedPublishedRevision),"operationalRevision":\(expectedOperationalRevision),"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"operations-proof"},"contests":[{"contestId":"M1","participantNames":["Pair 1","Pair 2"],"court":"Court 1","startsAt":"2026-09-20T14:00:00.000Z","status":"SCHEDULED","revision":\(expectedOperationalRevision),"projectionHash":"contest"}],"projectionHash":"public"},"participantLookup":[{"participantId":"pair.1","projection":{"participant":{"displayName":"Pair 1","status":"CHECKED_IN"},"operation":{"mode":"NORMAL","stateVersion":0,"instruction":"Competition operating normally.","effectiveAt":null,"stateProofHash":"operations-proof"},"revision":\(expectedOperationalRevision),"next":{"contestId":"M1","opponent":"Pair 2","court":"Court 1","reportingTime":"2026-09-20T13:50:00.000Z","startsAt":"2026-09-20T14:00:00.000Z","status":"SCHEDULED"},"projectionHash":"next"}}],"emergencyReadiness":{"status":"BLOCKED_MISSING_AUTHORITY_DATA","missingDecisionCodes":["VENUE_ADDRESS"],"emergencyContacts":[],"instructions":[]}}
        """.utf8)
        let key = Self.packPrivateKey.publicKey.rawRepresentation
        let envelope = SignedOfflineEventPackDTO(apiVersion: "1.0", algorithm: "Ed25519",
            keyId: "sha256:\(SHA256.hash(data: key).map { String(format: "%02x", $0) }.joined())",
            publicKeyBase64: key.base64EncodedString(), payloadBase64: payload.base64EncodedString(),
            signatureBase64: (try Self.packPrivateKey.signature(for: payload)).base64EncodedString())
        return try verifyOfflineEventPack(envelope, organizationID: organizationID, competitionID: competitionID,
            expectedPublishedRevision: expectedPublishedRevision,
            expectedOperationalRevision: expectedOperationalRevision, now: now)
    }

    nonisolated func verifyOfflineEventPack(_ envelope: SignedOfflineEventPackDTO, organizationID: String,
                                            competitionID: String, expectedPublishedRevision: Int,
                                            expectedOperationalRevision: Int, now: Date) throws -> VerifiedOfflineEventPack {
        try OfflineEventPackVerifier(trustedPublicKey: Self.packPrivateKey.publicKey.rawRepresentation).verify(
            envelope, organizationID: organizationID, competitionID: competitionID,
            publishedRevision: expectedPublishedRevision, operationalRevision: expectedOperationalRevision, now: now)
    }

    func fetchPortfolio() throws -> PortfolioDTO {
        PortfolioDTO(apiVersion: "1.0", items: [
            PortfolioTournamentDTO(id: "st-albans", name: "St Albans", revision: 1, certificationStatus: .certified),
        ])
    }

    func fetchBlueprint(tournamentID: String) throws -> BlueprintSummaryDTO {
        BlueprintSummaryDTO(apiVersion: "1.0", id: tournamentID, name: "St Albans", revision: 1,
                            certificationStatus: .certified, solverStatus: .optimal, participantCount: 48,
                            actualContestCount: 108, scheduledContestCount: 108, actionRequired: false)
    }

    func fetchSchedule(tournamentID: String) throws -> ScheduleDTO {
        ScheduleDTO(apiVersion: "1.0", tournamentID: tournamentID, timezone: "Europe/London",
                    solverStatus: .optimal, objectiveValueMinutes: 540, lowerBoundMinutes: 540,
                    optimalityGap: 0, items: [])
    }

    func fetchLiveControlRoom(tournamentID: String) throws -> LiveControlRoomDTO {
        LiveControlRoomDTO(apiVersion: "1.0", tournamentID: tournamentID, revision: 7,
                           publishedRevision: 1, operationalRevision: 2, stateProofHash: "state-proof",
                           asOf: "2026-09-20T12:00:00Z", timezone: "Europe/London",
                           summary: LiveControlRoomSummaryDTO(now: 0, next: 1, late: 0, blocked: 0, unreported: 0),
                           items: [])
    }

    func fetchFindings(tournamentID: String) throws -> FindingsDTO {
        FindingsDTO(apiVersion: "1.0", tournamentID: tournamentID, items: [])
    }

    func fetchCertification(tournamentID: String) throws -> CertificationDTO {
        CertificationDTO(apiVersion: "1.0", tournamentID: tournamentID, status: .certified,
                         statement: "Guard passed", certificationHash: "hash", proofIDs: [:])
    }
}
