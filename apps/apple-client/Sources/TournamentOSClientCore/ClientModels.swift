import Foundation

public enum CertificationStatusDTO: String, Codable, Equatable, Sendable {
    case certified = "CERTIFIED"
    case rejected = "REJECTED"
}

public enum SolverStatusDTO: String, Codable, Equatable, Sendable {
    case optimal = "OPTIMAL"
    case feasible = "FEASIBLE"
    case infeasible = "INFEASIBLE"
    case unknown = "UNKNOWN"
}

public enum FindingSeverityDTO: String, Codable, Equatable, Sendable {
    case error = "ERROR"
    case warning = "WARNING"
}

public enum CompetitionWorkspaceKindDTO: String, Codable, CaseIterable, Equatable, Sendable {
    case personal = "PERSONAL"
    case club = "CLUB"
    case promoter = "PROMOTER"
    case league = "LEAGUE"
    case federation = "FEDERATION"
    case whiteLabel = "WHITE_LABEL"

    public var displayName: String {
        switch self {
        case .personal: "Personal"
        case .club: "Club or facility"
        case .promoter: "Independent organiser"
        case .league: "League or circuit"
        case .federation: "Federation"
        case .whiteLabel: "White-label platform"
        }
    }
}

public struct CompetitionWorkspaceSummaryDTO: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let kind: CompetitionWorkspaceKindDTO
    public let roleName: String
    public let publicHost: String?
    public let isLocalPreview: Bool

    public init(
        id: String,
        name: String,
        kind: CompetitionWorkspaceKindDTO,
        roleName: String,
        publicHost: String? = nil,
        isLocalPreview: Bool = false
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.roleName = roleName
        self.publicHost = publicHost
        self.isLocalPreview = isLocalPreview
    }
}

public struct PortfolioTournamentDTO: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let revision: Int
    public let certificationStatus: CertificationStatusDTO

    public init(id: String, name: String, revision: Int, certificationStatus: CertificationStatusDTO) {
        self.id = id
        self.name = name
        self.revision = revision
        self.certificationStatus = certificationStatus
    }
}

public struct PortfolioDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let items: [PortfolioTournamentDTO]

    public init(apiVersion: String, items: [PortfolioTournamentDTO]) {
        self.apiVersion = apiVersion
        self.items = items
    }
}

public struct BlueprintSummaryDTO: Codable, Equatable, Sendable, Identifiable {
    public let apiVersion: String
    public let id: String
    public let name: String
    public let revision: Int
    public let certificationStatus: CertificationStatusDTO
    public let solverStatus: SolverStatusDTO
    public let participantCount: Int
    public let actualContestCount: Int
    public let scheduledContestCount: Int
    public let actionRequired: Bool

    public init(
        apiVersion: String,
        id: String,
        name: String,
        revision: Int,
        certificationStatus: CertificationStatusDTO,
        solverStatus: SolverStatusDTO,
        participantCount: Int,
        actualContestCount: Int,
        scheduledContestCount: Int,
        actionRequired: Bool
    ) {
        self.apiVersion = apiVersion
        self.id = id
        self.name = name
        self.revision = revision
        self.certificationStatus = certificationStatus
        self.solverStatus = solverStatus
        self.participantCount = participantCount
        self.actualContestCount = actualContestCount
        self.scheduledContestCount = scheduledContestCount
        self.actionRequired = actionRequired
    }
}

public struct ScheduleItemDTO: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let resourceID: String
    public let start: String
    public let end: String
    public let possibleEntrantIDs: [String]
    public let accessibilityLabel: String

    public init(id: String, resourceID: String, start: String, end: String, possibleEntrantIDs: [String], accessibilityLabel: String) {
        self.id = id
        self.resourceID = resourceID
        self.start = start
        self.end = end
        self.possibleEntrantIDs = possibleEntrantIDs
        self.accessibilityLabel = accessibilityLabel
    }
}

public struct ScheduleDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let tournamentID: String
    public let timezone: String
    public let solverStatus: SolverStatusDTO
    public let objectiveValueMinutes: Int?
    public let lowerBoundMinutes: Int
    public let optimalityGap: Double?
    public let items: [ScheduleItemDTO]

    public init(
        apiVersion: String,
        tournamentID: String,
        timezone: String,
        solverStatus: SolverStatusDTO,
        objectiveValueMinutes: Int?,
        lowerBoundMinutes: Int,
        optimalityGap: Double?,
        items: [ScheduleItemDTO]
    ) {
        self.apiVersion = apiVersion
        self.tournamentID = tournamentID
        self.timezone = timezone
        self.solverStatus = solverStatus
        self.objectiveValueMinutes = objectiveValueMinutes
        self.lowerBoundMinutes = lowerBoundMinutes
        self.optimalityGap = optimalityGap
        self.items = items
    }
}

public enum LiveOperationStatusDTO: String, Codable, Equatable, Sendable, CaseIterable {
    case now = "NOW"
    case next = "NEXT"
    case late = "LATE"
    case blocked = "BLOCKED"
    case unreported = "UNREPORTED"

    public var displayName: String {
        switch self {
        case .now: "Now"
        case .next: "Next"
        case .late: "Late"
        case .blocked: "Blocked"
        case .unreported: "Unreported"
        }
    }
}

public struct LiveControlRoomSummaryDTO: Codable, Equatable, Sendable {
    public let now: Int
    public let next: Int
    public let late: Int
    public let blocked: Int
    public let unreported: Int

    public init(now: Int, next: Int, late: Int, blocked: Int, unreported: Int) {
        self.now = now
        self.next = next
        self.late = late
        self.blocked = blocked
        self.unreported = unreported
    }
}

public struct LiveControlRoomItemDTO: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let contestID: String
    public let status: LiveOperationStatusDTO
    public let title: String
    public let statusText: String
    public let detail: String
    public let resourceID: String?
    public let scheduledStart: String?
    public let participantIDs: [String]?
    public let participantNames: [String]
    public let accessibilityLabel: String

    public init(
        id: String,
        contestID: String,
        status: LiveOperationStatusDTO,
        title: String,
        statusText: String,
        detail: String,
        resourceID: String?,
        scheduledStart: String?,
        participantIDs: [String]? = nil,
        participantNames: [String],
        accessibilityLabel: String
    ) {
        self.id = id
        self.contestID = contestID
        self.status = status
        self.title = title
        self.statusText = statusText
        self.detail = detail
        self.resourceID = resourceID
        self.scheduledStart = scheduledStart
        self.participantIDs = participantIDs
        self.participantNames = participantNames
        self.accessibilityLabel = accessibilityLabel
    }
}

public struct LiveControlRoomDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let tournamentID: String
    public let revision: Int
    public let publishedRevision: Int?
    public let operationalRevision: Int?
    public let stateProofHash: String?
    public let asOf: String
    public let timezone: String
    public let summary: LiveControlRoomSummaryDTO
    public let items: [LiveControlRoomItemDTO]

    public init(
        apiVersion: String,
        tournamentID: String,
        revision: Int,
        publishedRevision: Int? = nil,
        operationalRevision: Int? = nil,
        stateProofHash: String? = nil,
        asOf: String,
        timezone: String,
        summary: LiveControlRoomSummaryDTO,
        items: [LiveControlRoomItemDTO]
    ) {
        self.apiVersion = apiVersion
        self.tournamentID = tournamentID
        self.revision = revision
        self.publishedRevision = publishedRevision
        self.operationalRevision = operationalRevision
        self.stateProofHash = stateProofHash
        self.asOf = asOf
        self.timezone = timezone
        self.summary = summary
        self.items = items
    }
}

public struct FindingDTO: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let code: String
    public let severity: FindingSeverityDTO
    public let path: String
    public let message: String
    public let accessibilityLabel: String
    public let debugID: String

    public init(id: String, code: String, severity: FindingSeverityDTO, path: String, message: String, accessibilityLabel: String, debugID: String) {
        self.id = id
        self.code = code
        self.severity = severity
        self.path = path
        self.message = message
        self.accessibilityLabel = accessibilityLabel
        self.debugID = debugID
    }
}

public struct FindingsDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let tournamentID: String
    public let items: [FindingDTO]

    public init(apiVersion: String, tournamentID: String, items: [FindingDTO]) {
        self.apiVersion = apiVersion
        self.tournamentID = tournamentID
        self.items = items
    }
}

public struct CertificationDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let tournamentID: String
    public let status: CertificationStatusDTO
    public let statement: String
    public let certificationHash: String
    public let proofIDs: [String: String]

    public init(apiVersion: String, tournamentID: String, status: CertificationStatusDTO, statement: String, certificationHash: String, proofIDs: [String: String]) {
        self.apiVersion = apiVersion
        self.tournamentID = tournamentID
        self.status = status
        self.statement = statement
        self.certificationHash = certificationHash
        self.proofIDs = proofIDs
    }
}

public protocol VersionedAPIDTO: Codable, Sendable {
    var apiVersion: String { get }
}

extension PortfolioDTO: VersionedAPIDTO {}
extension BlueprintSummaryDTO: VersionedAPIDTO {}
extension ScheduleDTO: VersionedAPIDTO {}
extension LiveControlRoomDTO: VersionedAPIDTO {}
extension FindingsDTO: VersionedAPIDTO {}
extension CertificationDTO: VersionedAPIDTO {}
