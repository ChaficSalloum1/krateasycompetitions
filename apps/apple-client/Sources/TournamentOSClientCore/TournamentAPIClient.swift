import Foundation

public enum TournamentAPIClientError: Error, Equatable, Sendable {
    case invalidURL
    case transportFailed
    case invalidResponse
    case httpStatus(Int)
    case decodingFailed
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

public extension TournamentAPIClient {
    var workspaceKind: TournamentWorkspaceKind { .connected }
}

public final class URLSessionTournamentAPIClient: TournamentAPIClient, @unchecked Sendable {
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
}
