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

public extension TournamentAPIClient {
    var workspaceKind: TournamentWorkspaceKind { .connected }
}

public final class URLSessionTournamentAPIClient: TournamentAPIClient, CompetitionJourneyClient, @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let supportedAPIVersion: String

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        supportedAPIVersion: String = "1.0"
    ) {
        self.baseURL = baseURL
        self.session = session
        self.supportedAPIVersion = supportedAPIVersion
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
        guard ["http", "https"].contains(baseURL.scheme?.lowercased() ?? ""), baseURL.host != nil,
              pathComponents.allSatisfy({
                  !$0.isEmpty && $0 != "." && $0 != ".." &&
                  !$0.contains("/") && !$0.contains("\\") && !$0.contains("?") && !$0.contains("#")
              }) else {
            throw TournamentAPIClientError.invalidURL
        }
        let url = pathComponents.reduce(baseURL) { partial, component in
            partial.appendingPathComponent(component, isDirectory: false)
        }
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
        guard ["http", "https"].contains(baseURL.scheme?.lowercased() ?? ""), baseURL.host != nil,
              pathComponents.allSatisfy({ !$0.isEmpty && !$0.contains("/") && !$0.contains("\\") }) else {
            throw TournamentAPIClientError.invalidURL
        }
        let url = pathComponents.reduce(baseURL) { $0.appendingPathComponent($1, isDirectory: false) }
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
}

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
