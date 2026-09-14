import Foundation

public enum TournamentAPIClientError: Error, Equatable, Sendable {
    case invalidURL
    case transportFailed
    case invalidResponse
    case httpStatus(Int)
    case decodingFailed
    case unsupportedOperation
    case unsupportedAPIVersion(expected: String, received: String)
}

public enum TournamentWorkspaceKind: Equatable, Sendable {
    case connected
    case demo
}

public protocol TournamentAPIClient: Sendable {
    var workspaceKind: TournamentWorkspaceKind { get }
    func fetchPortfolio() async throws -> PortfolioDTO
    func fetchBlueprint(tournamentID: String) async throws -> BlueprintSummaryDTO
    func fetchSchedule(tournamentID: String) async throws -> ScheduleDTO
    func fetchLiveControlRoom(tournamentID: String) async throws -> LiveControlRoomDTO
    func fetchFindings(tournamentID: String) async throws -> FindingsDTO
    func fetchCertification(tournamentID: String) async throws -> CertificationDTO
}

public struct CompetitionCreationInput: Codable, Equatable, Sendable {
    public let name: String
    public let sport: String
    public let participantUnit: String
    public let participantCount: Int
    public let resourceCount: Int
    public let resourceLabel: String
    public let format: String
    public let poolSize: Int
    public let qualifiersPerPool: Int
    public let minimumMatches: Int
    public let minimumRestMinutes: Int
    public let matchDurationMinutes: Int
    public let startsAt: String
    public let endsAt: String
    public let priority: String

    public init(name: String, sport: String, participantUnit: String, participantCount: Int,
                resourceCount: Int, resourceLabel: String, format: String, poolSize: Int,
                qualifiersPerPool: Int, minimumMatches: Int, minimumRestMinutes: Int,
                matchDurationMinutes: Int, startsAt: String, endsAt: String, priority: String) {
        self.name = name; self.sport = sport; self.participantUnit = participantUnit
        self.participantCount = participantCount; self.resourceCount = resourceCount
        self.resourceLabel = resourceLabel; self.format = format; self.poolSize = poolSize
        self.qualifiersPerPool = qualifiersPerPool; self.minimumMatches = minimumMatches
        self.minimumRestMinutes = minimumRestMinutes; self.matchDurationMinutes = matchDurationMinutes
        self.startsAt = startsAt; self.endsAt = endsAt; self.priority = priority
    }
}

public enum CompetitionCreationSourceInput: Encodable, Equatable, Sendable {
    case language(String)
    case quick(CompetitionCreationInput)

    private enum CodingKeys: String, CodingKey { case mode, text, value }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .language(let text):
            try container.encode("language", forKey: .mode)
            try container.encode(text, forKey: .text)
        case .quick(let value):
            try container.encode("quick", forKey: .mode)
            try container.encode(value, forKey: .value)
        }
    }
}

public struct CompetitionJourneyCompiledDTO: Codable, Equatable, Sendable {
    public let guardStatus: String
    public let requiredAcknowledgementCodes: [String]
}

public struct CompetitionBlueprintInputDTO: Codable, Equatable, Sendable {
    public let name: String?
    public let sport: String?
    public let participantUnit: String?
    public let participantCount: Int?
    public let resourceCount: Int?
    public let resourceLabel: String?
    public let format: String?
    public let poolSize: Int?
    public let qualifiersPerPool: Int?
    public let minimumMatches: Int?
    public let minimumRestMinutes: Int?
    public let matchDurationMinutes: Int?
    public let startsAt: String?
    public let endsAt: String?
    public let priority: String?
}

public struct CompetitionJourneyQuestionDTO: Codable, Equatable, Sendable, Identifiable {
    public let field: String
    public let prompt: String
    public let why: String
    public let blocking: Bool
    public var id: String { "\(field):\(prompt)" }
}

public struct CompetitionJourneyAssumptionDTO: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let rulePath: String
    public let origin: String
    public let knowledge: String
    public let approved: Bool
    public let critical: Bool
}

public struct CompetitionJourneyDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let id: String
    public let name: String
    public let draftVersion: Int
    public let revision: Int
    public let status: String
    public let blueprint: CompetitionBlueprintInputDTO
    public let understood: [String]
    public let questions: [CompetitionJourneyQuestionDTO]
    public let warnings: [String]
    public let supportFindings: [String]
    public let assumptions: [CompetitionJourneyAssumptionDTO]
    public let compiled: CompetitionJourneyCompiledDTO?
    public let webPath: String
}

public protocol CompetitionJourneyClient: Sendable {
    var competitionWebBaseURL: URL { get }
    func createCompetitionDraft(_ source: CompetitionCreationSourceInput) async throws -> CompetitionJourneyDTO
    func reviseCompetitionDraft(id: String, expectedDraftVersion: Int, source: CompetitionCreationSourceInput) async throws -> CompetitionJourneyDTO
    func compileCompetition(id: String, expectedDraftVersion: Int) async throws -> CompetitionJourneyDTO
    func approveCompetition(id: String, expectedRevision: Int, acknowledgedFindingCodes: [String]) async throws -> CompetitionJourneyDTO
    func createApprovedCompetition(_ source: CompetitionCreationSourceInput) async throws -> CompetitionJourneyDTO
}

public protocol OfflineEventPackClient: Sendable {
    func fetchOfflineEventPack(competitionID: String, organizationID: String, expectedPublishedRevision: Int,
                               expectedOperationalRevision: Int, expiresAt: String, now: Date) async throws -> VerifiedOfflineEventPack
    func verifyOfflineEventPack(_ envelope: SignedOfflineEventPackDTO, organizationID: String, competitionID: String,
                                expectedPublishedRevision: Int, expectedOperationalRevision: Int,
                                now: Date) throws -> VerifiedOfflineEventPack
}

public extension TournamentAPIClient {
    var workspaceKind: TournamentWorkspaceKind { .connected }
}

public final class URLSessionTournamentAPIClient: TournamentAPIClient, CompetitionJourneyClient, OfflineCommandTransport, OfflineEventPackClient, @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let supportedAPIVersion: String
    private let trustedOfflinePackPublicKey: Data?

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        supportedAPIVersion: String = "1.0",
        trustedOfflinePackPublicKey: Data? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.supportedAPIVersion = supportedAPIVersion
        self.trustedOfflinePackPublicKey = trustedOfflinePackPublicKey
    }

    public var competitionWebBaseURL: URL { baseURL }

    public func createCompetitionDraft(_ source: CompetitionCreationSourceInput) async throws -> CompetitionJourneyDTO {
        try await send(
            pathComponents: ["v1", "competition-journey"],
            body: CreateJourneyCommand(source: source)
        )
    }

    public func reviseCompetitionDraft(id: String, expectedDraftVersion: Int, source: CompetitionCreationSourceInput) async throws -> CompetitionJourneyDTO {
        try await send(pathComponents: ["v1", "competition-journey", id, "draft"],
                       body: ReviseJourneyCommand(expectedDraftVersion: expectedDraftVersion, source: source))
    }

    public func compileCompetition(id: String, expectedDraftVersion: Int) async throws -> CompetitionJourneyDTO {
        try await send(
            pathComponents: ["v1", "competition-journey", id, "compile"],
            body: CompileJourneyCommand(expectedDraftVersion: expectedDraftVersion)
        )
    }

    public func approveCompetition(id: String, expectedRevision: Int, acknowledgedFindingCodes: [String]) async throws -> CompetitionJourneyDTO {
        try await send(
            pathComponents: ["v1", "competition-journey", id, "approve"],
            body: ApproveJourneyCommand(expectedRevision: expectedRevision, acknowledgedFindingCodes: acknowledgedFindingCodes)
        )
    }

    public func createApprovedCompetition(_ source: CompetitionCreationSourceInput) async throws -> CompetitionJourneyDTO {
        let draft = try await createCompetitionDraft(source)
        let compiled = try await compileCompetition(id: draft.id, expectedDraftVersion: draft.draftVersion)
        guard compiled.compiled?.guardStatus == "PASSED" else { throw TournamentAPIClientError.invalidResponse }
        return try await approveCompetition(id: draft.id, expectedRevision: compiled.revision,
                                            acknowledgedFindingCodes: compiled.compiled?.requiredAcknowledgementCodes ?? [])
    }

    public func fetchOfflineEventPack(competitionID: String, organizationID: String,
                                      expectedPublishedRevision: Int, expectedOperationalRevision: Int,
                                      expiresAt: String, now: Date = Date()) async throws -> VerifiedOfflineEventPack {
        guard let trustedOfflinePackPublicKey else { throw OfflineEventPackError.trustNotConfigured }
        let envelope: SignedOfflineEventPackDTO = try await send(
            pathComponents: ["v1", "competition-journey", competitionID, "offline-pack"],
            body: OfflineEventPackCommand(expectedPublishedRevision: expectedPublishedRevision,
                                          expectedOperationalRevision: expectedOperationalRevision,
                                          expiresAt: expiresAt)
        )
        return try OfflineEventPackVerifier(trustedPublicKey: trustedOfflinePackPublicKey).verify(
            envelope, organizationID: organizationID, competitionID: competitionID,
            publishedRevision: expectedPublishedRevision, operationalRevision: expectedOperationalRevision, now: now
        )
    }

    public func verifyOfflineEventPack(_ envelope: SignedOfflineEventPackDTO, organizationID: String,
                                       competitionID: String, expectedPublishedRevision: Int,
                                       expectedOperationalRevision: Int, now: Date = Date()) throws -> VerifiedOfflineEventPack {
        guard let trustedOfflinePackPublicKey else { throw OfflineEventPackError.trustNotConfigured }
        return try OfflineEventPackVerifier(trustedPublicKey: trustedOfflinePackPublicKey).verify(
            envelope, organizationID: organizationID, competitionID: competitionID,
            publishedRevision: expectedPublishedRevision, operationalRevision: expectedOperationalRevision, now: now
        )
    }

    public func submit(_ envelope: OfflineCommandEnvelope) async throws -> OfflineCommandReceipt {
        guard let body = try? JSONSerialization.jsonObject(with: envelope.payload) as? [String: Any],
              let boundary = offlineBoundary(envelope: envelope, body: body) else {
            throw OfflineCommandTransportError.rejected(
                actualAggregateVersion: envelope.expectedAggregateVersion,
                reason: "offline_command_envelope_mismatch"
            )
        }
        let url: URL
        do { url = try requestURL(pathComponents: ["v1", "competition-journey", envelope.aggregateID, boundary.path]) }
        catch {
            throw OfflineCommandTransportError.rejected(
                actualAggregateVersion: envelope.expectedAggregateVersion,
                reason: "invalid_competition_identity"
            )
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = envelope.payload
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw OfflineCommandTransportError.unavailable }
        guard let http = response as? HTTPURLResponse else { throw OfflineCommandTransportError.unavailable }
        if (200..<300).contains(http.statusCode),
           let accepted = try? JSONDecoder().decode(OfflineCommandResponse.self, from: data),
           let version = boundary == .live ? accepted.live.state?.version : accepted.live.operations?.version {
            return OfflineCommandReceipt(aggregateVersion: version)
        }
        if http.statusCode == 408 || http.statusCode == 429 || http.statusCode >= 500 {
            throw OfflineCommandTransportError.unavailable
        }
        let reason = (try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error)
            ?? "authoritative_server_rejected_command"
        let actualVersion = (try? await fetchJourneyHead(competitionID: envelope.aggregateID, boundary: boundary))
            ?? envelope.expectedAggregateVersion
        throw OfflineCommandTransportError.rejected(actualAggregateVersion: actualVersion, reason: reason)
    }

    private enum OfflineBoundary: Equatable {
        case live
        case operationalIncident
        case operationalTransition

        var path: String {
            switch self {
            case .live: "live-command"
            case .operationalIncident: "operational-incident"
            case .operationalTransition: "operational-transition"
            }
        }
    }

    private func offlineBoundary(envelope: OfflineCommandEnvelope,
                                 body: [String: Any]) -> OfflineBoundary? {
        let liveCommands: Set<String> = ["CHECK_IN", "CALL_CONTEST", "START_CONTEST", "RECORD_SCORE",
                                         "COMPLETE_CONTEST", "AWARD_WALKOVER", "CORRECT_OPERATION"]
        if liveCommands.contains(envelope.commandName),
           Set(body.keys) == ["expectedRevision", "command"], body["expectedRevision"] as? Int != nil,
           let command = body["command"] as? [String: Any],
           command["commandId"] as? String == envelope.idempotencyKey,
           command["kind"] as? String == envelope.commandName,
           command["expectedVersion"] as? Int == envelope.expectedAggregateVersion {
            return .live
        }
        let commonOperational = body["commandId"] as? String == envelope.idempotencyKey
            && body["expectedStateVersion"] as? Int == envelope.expectedAggregateVersion
            && body["expectedOperationalRevision"] as? Int != nil
            && body["actorId"] == nil && body["occurredAt"] == nil
        if envelope.commandName == "RECORD_INCIDENT", commonOperational {
            let keys: Set<String> = ["expectedOperationalRevision", "expectedStateVersion", "commandId", "incidentId",
                                     "category", "severity", "acknowledgement", "location", "summary",
                                     "affectedContestIds", "affectedResourceIds", "affectedParticipantIds", "evidenceRefs"]
            return Set(body.keys) == keys ? .operationalIncident : nil
        }
        if envelope.commandName == "TRANSITION_MODE", commonOperational,
           body["publicMessageCode"] == nil, body["nextUpdateAt"] == nil {
            var keys: Set<String> = ["expectedOperationalRevision", "expectedStateVersion", "commandId", "targetMode",
                                     "reason", "scope"]
            if body["sourceIncidentId"] != nil { keys.insert("sourceIncidentId") }
            return Set(body.keys) == keys ? .operationalTransition : nil
        }
        return nil
    }

    public func fetchPortfolio() async throws -> PortfolioDTO {
        try await fetch(pathComponents: ["v1", "tournaments"])
    }

    public func fetchBlueprint(tournamentID: String) async throws -> BlueprintSummaryDTO {
        try await fetch(pathComponents: ["v1", "tournaments", tournamentID, "blueprint"])
    }

    public func fetchSchedule(tournamentID: String) async throws -> ScheduleDTO {
        try await fetch(pathComponents: ["v1", "tournaments", tournamentID, "schedule"])
    }

    public func fetchLiveControlRoom(tournamentID: String) async throws -> LiveControlRoomDTO {
        try await fetch(pathComponents: ["v1", "tournaments", tournamentID, "operations"])
    }

    public func fetchFindings(tournamentID: String) async throws -> FindingsDTO {
        try await fetch(pathComponents: ["v1", "tournaments", tournamentID, "findings"])
    }

    public func fetchCertification(tournamentID: String) async throws -> CertificationDTO {
        try await fetch(pathComponents: ["v1", "tournaments", tournamentID, "certification"])
    }

    private func fetch<Response: VersionedAPIDTO>(pathComponents: [String]) async throws -> Response {
        let url = try requestURL(pathComponents: pathComponents)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw TournamentAPIClientError.transportFailed
        }
        guard let http = response as? HTTPURLResponse else {
            throw TournamentAPIClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw TournamentAPIClientError.httpStatus(http.statusCode)
        }
        let decoded: Response
        do {
            decoded = try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw TournamentAPIClientError.decodingFailed
        }
        guard decoded.apiVersion == supportedAPIVersion else {
            throw TournamentAPIClientError.unsupportedAPIVersion(expected: supportedAPIVersion, received: decoded.apiVersion)
        }
        return decoded
    }

    private func send<Body: Encodable, Response: Decodable>(pathComponents: [String], body: Body) async throws -> Response {
        let url = try requestURL(pathComponents: pathComponents)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(body)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw TournamentAPIClientError.transportFailed }
        guard let http = response as? HTTPURLResponse else { throw TournamentAPIClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw TournamentAPIClientError.httpStatus(http.statusCode) }
        do { return try JSONDecoder().decode(Response.self, from: data) }
        catch { throw TournamentAPIClientError.decodingFailed }
    }

    private func requestURL(pathComponents: [String]) throws -> URL {
        guard ["http", "https"].contains(baseURL.scheme?.lowercased() ?? ""), baseURL.host != nil,
              pathComponents.allSatisfy({
                  !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("/") && !$0.contains("\\")
                      && !$0.contains("?") && !$0.contains("#")
              }) else { throw TournamentAPIClientError.invalidURL }
        return pathComponents.reduce(baseURL) { $0.appendingPathComponent($1, isDirectory: false) }
    }

    private func fetchJourneyHead(competitionID: String, boundary: OfflineBoundary) async throws -> Int {
        let url = try requestURL(pathComponents: ["v1", "competition-journey", competitionID])
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let head = try? JSONDecoder().decode(OfflineCommandResponse.self, from: data) else {
            throw TournamentAPIClientError.invalidResponse
        }
        if boundary == .live, let version = head.live.state?.version { return version }
        if boundary != .live, let version = head.live.operations?.version { return version }
        throw TournamentAPIClientError.invalidResponse
    }
}

private struct OfflineCommandResponse: Decodable {
    struct Live: Decodable {
        struct State: Decodable { let version: Int }
        let state: State?
        let operations: State?
    }
    let live: Live
}

private struct ServerErrorResponse: Decodable { let error: String }

private struct CreateJourneyCommand: Encodable { let source: CompetitionCreationSourceInput }
private struct ReviseJourneyCommand: Encodable {
    let expectedDraftVersion: Int
    let source: CompetitionCreationSourceInput
}
private struct CompileJourneyCommand: Encodable { let expectedDraftVersion: Int }
private struct ApproveJourneyCommand: Encodable {
    let expectedRevision: Int
    let acknowledgedFindingCodes: [String]
}
private struct OfflineEventPackCommand: Encodable {
    let expectedPublishedRevision: Int
    let expectedOperationalRevision: Int
    let expiresAt: String
}
