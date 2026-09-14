import Foundation
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

private func makeClient() -> (URLSessionTournamentAPIClient, StubTransport) {
    let transport = StubTransport()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    StubURLProtocol.transport = transport
    let session = URLSession(configuration: configuration)
    return (URLSessionTournamentAPIClient(baseURL: URL(string: "https://example.test")!, session: session), transport)
}

private final class StubTransport: @unchecked Sendable {
    private let lock = NSLock()
    private var response: (Int, Data) = (500, Data())
    private var request: URLRequest?

    var lastRequest: URLRequest? { lock.withLock { request } }

    func respond(status: Int, json: String) {
        lock.withLock { response = (status, Data(json.utf8)) }
    }

    func handle(_ request: URLRequest) -> (HTTPURLResponse, Data) {
        lock.withLock {
            self.request = request
            return (HTTPURLResponse(url: request.url!, statusCode: response.0, httpVersion: nil,
                                    headerFields: ["Content-Type": "application/json"])!, response.1)
        }
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
