import Observation
import SwiftUI

public enum WorkspaceDestination: String, Equatable, Sendable {
    case portfolio
    case tournament
}

public enum AppSheet: String, Identifiable, Sendable {
    case newTournament
    case editTournament

    public var id: String { rawValue }
}

public enum CompetitionStartPreset: String, CaseIterable, Identifiable, Sendable {
    case quickPlay
    case clubEvent
    case leagueSeason
    case complexEvent

    public var id: String { rawValue }
}

public struct TournamentWorkspaceSession: Sendable {
    public let workspace: CompetitionWorkspaceSummaryDTO
    public let client: any TournamentAPIClient

    public init(workspace: CompetitionWorkspaceSummaryDTO, client: any TournamentAPIClient) {
        self.workspace = workspace
        self.client = client
    }
}

public struct LocalTournamentDraft: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let clubName: String
    public let startsAt: Date
    public let sport: String
    public let participantCount: Int
    public let formatName: String
    public let courtCount: Int
    public let minimumRestMinutes: Int
    public let priority: String

    public init(
        id: String = "local.\(UUID().uuidString.lowercased())",
        name: String,
        clubName: String,
        startsAt: Date,
        sport: String,
        participantCount: Int,
        formatName: String,
        courtCount: Int,
        minimumRestMinutes: Int,
        priority: String
    ) {
        self.id = id
        self.name = name
        self.clubName = clubName
        self.startsAt = startsAt
        self.sport = sport
        self.participantCount = participantCount
        self.formatName = formatName
        self.courtCount = courtCount
        self.minimumRestMinutes = minimumRestMinutes
        self.priority = priority
    }
}

public enum OrganiserSection: String, CaseIterable, Identifiable, Hashable, Sendable {
    case today
    case operations
    case event
    case schedule
    case participants
    case competition
    case findings
    case scenarios
    case certification
    case settings

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .today: "Home"
        case .operations: "Run event"
        case .event: "Overview"
        case .schedule: "Schedule"
        case .participants: "People"
        case .competition: "Format & rules"
        case .findings: "Issues"
        case .scenarios: "What-if plans"
        case .certification: "Evidence"
        case .settings: "Settings"
        }
    }

    public var systemImage: String {
        switch self {
        case .today: "house"
        case .operations: "play.circle"
        case .event: "map"
        case .schedule: "calendar"
        case .participants: "person.2"
        case .competition: "point.3.connected.trianglepath.dotted"
        case .findings: "exclamationmark.triangle"
        case .scenarios: "arrow.triangle.branch"
        case .certification: "checkmark.seal"
        case .settings: "gearshape"
        }
    }
}

public enum CompactTab: String, CaseIterable, Identifiable, Hashable, Sendable {
    case home
    case run
    case schedule
    case people
    case more

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .home: "Home"
        case .run: "Run"
        case .schedule: "Schedule"
        case .people: "People"
        case .more: "More"
        }
    }

    public var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .run: "play.circle.fill"
        case .schedule: "calendar"
        case .people: "person.2.fill"
        case .more: "ellipsis.circle"
        }
    }
}

public enum AppRoute: Hashable, Identifiable, Sendable {
    case operations
    case event
    case schedule
    case scheduleItem(id: String)
    case findings
    case finding(id: String)
    case certification
    case participants
    case competition
    case scenarios
    case settings

    public var id: String {
        switch self {
        case .operations: "operations"
        case .event: "event"
        case .schedule: "schedule"
        case .scheduleItem(let id): "schedule-item:\(id)"
        case .findings: "findings"
        case .finding(let id): "finding:\(id)"
        case .certification: "certification"
        case .participants: "participants"
        case .competition: "competition"
        case .scenarios: "scenarios"
        case .settings: "settings"
        }
    }
}

public struct AppLoadFailure: Error, Equatable, Sendable, Identifiable {
    public let message: String
    public var id: String { message }

    public init(message: String) {
        self.message = message
    }
}

public enum ContentState<Value: Sendable>: Sendable {
    case idle
    case loading
    case loaded(Value)
    case failed(AppLoadFailure)
}

@MainActor
@Observable
public final class TournamentOSAppModel {
    public private(set) var availableWorkspaces: [CompetitionWorkspaceSummaryDTO]
    public private(set) var selectedWorkspaceID: String
    public var portfolioState: ContentState<PortfolioDTO> = .idle
    public var blueprintState: ContentState<BlueprintSummaryDTO> = .idle
    public var scheduleState: ContentState<ScheduleDTO> = .idle
    public var operationsState: ContentState<LiveControlRoomDTO> = .idle
    public var findingsState: ContentState<FindingsDTO> = .idle
    public var certificationState: ContentState<CertificationDTO> = .idle

    public var selectedTournamentID: String?
    public var workspaceDestination: WorkspaceDestination = .portfolio
    public var presentedSheet: AppSheet?
    public var editingDraftID: String?
    public var creationPreset: CompetitionStartPreset = .clubEvent
    public var selectedSection: OrganiserSection = .today
    public var selectedCompactTab: CompactTab = .home
    public var homePath: [AppRoute] = []
    public var runPath: [AppRoute] = []
    public var schedulePath: [AppRoute] = []
    public var peoplePath: [AppRoute] = []
    public var morePath: [AppRoute] = []
    public private(set) var localDrafts: [LocalTournamentDraft] = []

    private let sessionsByWorkspaceID: [String: TournamentWorkspaceSession]
    private let draftStorage: UserDefaults?
    private static let draftStorageKeyPrefix = "krateasy.competitions.local-drafts.v2"

    public init(
        client: any TournamentAPIClient,
        workspace: CompetitionWorkspaceSummaryDTO = CompetitionWorkspaceSummaryDTO(
            id: "connected",
            name: "Competition workspace",
            kind: .club,
            roleName: "Organiser"
        ),
        draftStorage: UserDefaults? = nil
    ) {
        self.availableWorkspaces = [workspace]
        self.selectedWorkspaceID = workspace.id
        self.sessionsByWorkspaceID = [workspace.id: TournamentWorkspaceSession(workspace: workspace, client: client)]
        self.draftStorage = draftStorage
        self.localDrafts = Self.readDrafts(from: draftStorage, workspaceID: workspace.id)
    }

    public init(workspaces: [TournamentWorkspaceSession], draftStorage: UserDefaults? = nil) {
        precondition(!workspaces.isEmpty, "At least one competition workspace is required")
        let ordered = workspaces.sorted {
            let comparison = $0.workspace.name.localizedCaseInsensitiveCompare($1.workspace.name)
            return comparison == .orderedSame ? $0.workspace.id < $1.workspace.id : comparison == .orderedAscending
        }
        let first = ordered[0].workspace
        self.availableWorkspaces = ordered.map(\.workspace)
        self.selectedWorkspaceID = first.id
        self.sessionsByWorkspaceID = Dictionary(uniqueKeysWithValues: ordered.map { ($0.workspace.id, $0) })
        self.draftStorage = draftStorage
        self.localDrafts = Self.readDrafts(from: draftStorage, workspaceID: first.id)
    }

    public var activeWorkspace: CompetitionWorkspaceSummaryDTO {
        sessionsByWorkspaceID[selectedWorkspaceID]!.workspace
    }

    public var selectedCompetitionName: String? {
        guard let selectedTournamentID, case .loaded(let portfolio) = portfolioState else { return nil }
        return portfolio.items.first(where: { $0.id == selectedTournamentID })?.name
    }

    public var isDemoWorkspace: Bool { activeClient.workspaceKind == .demo }

    private var activeClient: any TournamentAPIClient {
        sessionsByWorkspaceID[selectedWorkspaceID]!.client
    }

    public func isLocalDraft(_ tournamentID: String?) -> Bool {
        guard let tournamentID else { return false }
        return localDrafts.contains(where: { $0.id == tournamentID })
    }

    public func showPortfolio() {
        workspaceDestination = .portfolio
        resetNavigationPaths()
    }

    public func selectWorkspace(_ workspaceID: String) {
        guard workspaceID != selectedWorkspaceID, sessionsByWorkspaceID[workspaceID] != nil else { return }
        selectedWorkspaceID = workspaceID
        selectedTournamentID = nil
        workspaceDestination = .portfolio
        selectedSection = .today
        selectedCompactTab = .home
        portfolioState = .idle
        clearCompetitionState()
        localDrafts = Self.readDrafts(from: draftStorage, workspaceID: workspaceID)
        resetNavigationPaths()
    }

    public func openTournament(_ tournamentID: String) {
        selectedTournamentID = tournamentID
        selectedSection = .today
        selectedCompactTab = .home
        workspaceDestination = .tournament
        resetNavigationPaths()
    }

    public func beginTournamentCreation(preset: CompetitionStartPreset = .clubEvent) {
        creationPreset = preset
        editingDraftID = nil
        presentedSheet = .newTournament
    }

    public func beginEditingDraft(_ tournamentID: String) {
        guard isLocalDraft(tournamentID) else { return }
        editingDraftID = tournamentID
        presentedSheet = .editTournament
    }

    public func localDraft(_ tournamentID: String?) -> LocalTournamentDraft? {
        guard let tournamentID else { return nil }
        return localDrafts.first(where: { $0.id == tournamentID })
    }

    public func saveLocalDraft(_ draft: LocalTournamentDraft) {
        if let index = localDrafts.firstIndex(where: { $0.id == draft.id }) {
            localDrafts[index] = draft
        } else {
            localDrafts.append(draft)
        }
        persistLocalDrafts()
        mergePortfolio(with: currentRemotePortfolioItems())
        openTournament(draft.id)
        loadLocalDraft(draft)
        editingDraftID = nil
    }

    public func pathBinding(for tab: CompactTab) -> Binding<[AppRoute]> {
        Binding(
            get: {
                switch tab {
                case .home: self.homePath
                case .run: self.runPath
                case .schedule: self.schedulePath
                case .people: self.peoplePath
                case .more: self.morePath
                }
            },
            set: { value in
                switch tab {
                case .home: self.homePath = value
                case .run: self.runPath = value
                case .schedule: self.schedulePath = value
                case .people: self.peoplePath = value
                case .more: self.morePath = value
                }
            }
        )
    }

    public func loadPortfolioIfNeeded() async {
        guard case .idle = portfolioState else { return }
        await loadPortfolio()
    }

    public func loadPortfolio() async {
        portfolioState = .loading
        do {
            let portfolio = try await activeClient.fetchPortfolio()
            guard !Task.isCancelled else { return }
            let ordered = portfolioWithLocalDrafts(remote: portfolio)
            portfolioState = .loaded(ordered)
            if selectedTournamentID == nil || !ordered.items.contains(where: { $0.id == selectedTournamentID }) {
                selectedTournamentID = ordered.items.first?.id
            }
        } catch is CancellationError {
            return
        } catch {
            portfolioState = .failed(AppLoadFailure(message: Self.message(for: error)))
        }
    }

    public func loadSelectedTournament() async {
        guard let tournamentID = selectedTournamentID else {
            blueprintState = .idle
            scheduleState = .idle
            operationsState = .idle
            findingsState = .idle
            certificationState = .idle
            return
        }
        if let draft = localDrafts.first(where: { $0.id == tournamentID }) {
            loadLocalDraft(draft)
            return
        }
        blueprintState = .loading
        scheduleState = .loading
        operationsState = .loading
        findingsState = .loading
        certificationState = .loading
        do {
            async let blueprint = activeClient.fetchBlueprint(tournamentID: tournamentID)
            async let schedule = activeClient.fetchSchedule(tournamentID: tournamentID)
            async let operations = activeClient.fetchLiveControlRoom(tournamentID: tournamentID)
            async let findings = activeClient.fetchFindings(tournamentID: tournamentID)
            async let certification = activeClient.fetchCertification(tournamentID: tournamentID)
            let loaded = try await (blueprint, schedule, operations, findings, certification)
            guard !Task.isCancelled, selectedTournamentID == tournamentID else { return }
            blueprintState = .loaded(loaded.0)
            scheduleState = .loaded(loaded.1)
            operationsState = .loaded(loaded.2)
            findingsState = .loaded(loaded.3)
            certificationState = .loaded(loaded.4)
        } catch is CancellationError {
            return
        } catch {
            guard selectedTournamentID == tournamentID else { return }
            let failure = AppLoadFailure(message: Self.message(for: error))
            blueprintState = .failed(failure)
            scheduleState = .failed(failure)
            operationsState = .failed(failure)
            findingsState = .failed(failure)
            certificationState = .failed(failure)
        }
    }

    public func refresh() async {
        await loadPortfolio()
        await loadSelectedTournament()
    }

    private static func message(for error: Error) -> String {
        switch error {
        case TournamentAPIClientError.unsupportedAPIVersion:
            "This TournamentOS server uses an unsupported API version."
        case TournamentAPIClientError.httpStatus(let status):
            "The server returned status \(status)."
        case TournamentAPIClientError.transportFailed:
            "TournamentOS could not reach the server."
        default:
            "Tournament data could not be loaded."
        }
    }

    private func resetNavigationPaths() {
        homePath = []
        runPath = []
        schedulePath = []
        peoplePath = []
        morePath = []
    }

    private func clearCompetitionState() {
        blueprintState = .idle
        scheduleState = .idle
        operationsState = .idle
        findingsState = .idle
        certificationState = .idle
    }

    private func currentRemotePortfolioItems() -> [PortfolioTournamentDTO] {
        guard case .loaded(let portfolio) = portfolioState else { return [] }
        return portfolio.items.filter { item in !localDrafts.contains(where: { $0.id == item.id }) }
    }

    private func portfolioWithLocalDrafts(remote: PortfolioDTO) -> PortfolioDTO {
        let localItems = localDrafts.map {
            PortfolioTournamentDTO(id: $0.id, name: $0.name, revision: 0, certificationStatus: .rejected)
        }
        return PortfolioDTO(apiVersion: remote.apiVersion, items: sortedPortfolioItems(remote.items + localItems))
    }

    private func mergePortfolio(with remoteItems: [PortfolioTournamentDTO]) {
        let remote = PortfolioDTO(apiVersion: "1.0", items: remoteItems)
        portfolioState = .loaded(portfolioWithLocalDrafts(remote: remote))
    }

    private func sortedPortfolioItems(_ items: [PortfolioTournamentDTO]) -> [PortfolioTournamentDTO] {
        items.sorted {
            let left = $0.name.lowercased()
            let right = $1.name.lowercased()
            if left != right { return left < right }
            if $0.name != $1.name { return $0.name < $1.name }
            return $0.id < $1.id
        }
    }

    private func persistLocalDrafts() {
        guard let draftStorage, let data = try? JSONEncoder().encode(localDrafts) else { return }
        draftStorage.set(data, forKey: Self.draftStorageKey(workspaceID: selectedWorkspaceID))
    }

    private static func draftStorageKey(workspaceID: String) -> String {
        "\(draftStorageKeyPrefix).\(workspaceID)"
    }

    private static func readDrafts(from storage: UserDefaults?, workspaceID: String) -> [LocalTournamentDraft] {
        guard let data = storage?.data(forKey: draftStorageKey(workspaceID: workspaceID)),
              let drafts = try? JSONDecoder().decode([LocalTournamentDraft].self, from: data) else { return [] }
        return drafts
    }

    private func loadLocalDraft(_ draft: LocalTournamentDraft) {
        blueprintState = .loaded(BlueprintSummaryDTO(
            apiVersion: "1.0", id: draft.id, name: draft.name, revision: 0,
            certificationStatus: .rejected, solverStatus: .unknown,
            participantCount: draft.participantCount, actualContestCount: 0,
            scheduledContestCount: 0, actionRequired: true
        ))
        scheduleState = .loaded(ScheduleDTO(
            apiVersion: "1.0", tournamentID: draft.id, timezone: TimeZone.current.identifier,
            solverStatus: .unknown, objectiveValueMinutes: nil, lowerBoundMinutes: 0,
            optimalityGap: nil, items: []
        ))
        operationsState = .loaded(LiveControlRoomDTO(
            apiVersion: "1.0", tournamentID: draft.id, revision: 0,
            asOf: ISO8601DateFormatter().string(from: Date()), timezone: TimeZone.current.identifier,
            summary: LiveControlRoomSummaryDTO(now: 0, next: 0, late: 0, blocked: 0, unreported: 0),
            items: []
        ))
        findingsState = .loaded(FindingsDTO(apiVersion: "1.0", tournamentID: draft.id, items: [
            FindingDTO(
                id: "draft-not-compiled", code: "DRAFT001", severity: .warning,
                path: "/lifecycle", message: "This local draft has not been compiled or published.",
                accessibilityLabel: "Draft warning: this tournament has not been compiled or published",
                debugID: "local-draft"
            ),
        ]))
        certificationState = .loaded(CertificationDTO(
            apiVersion: "1.0", tournamentID: draft.id, status: .rejected,
            statement: "No certificate exists until this draft is compiled and verified.",
            certificationHash: "Not yet generated", proofIDs: [:]
        ))
    }
}

public struct TournamentOSAppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var model: TournamentOSAppModel

    public init(model: TournamentOSAppModel) {
        _model = State(initialValue: model)
    }

    public init(client: any TournamentAPIClient) {
        _model = State(initialValue: TournamentOSAppModel(client: client))
    }

    public init() {
        _model = State(initialValue: TournamentOSAppModel(workspaces: demoWorkspaceSessions(), draftStorage: .standard))
    }

    public var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                CompactTournamentShell(model: model)
            } else {
                RegularTournamentShell(model: model)
            }
        }
        .tint(CompetitionTheme.accent)
        .task(id: model.selectedWorkspaceID) {
            await model.loadPortfolio()
        }
        .task(id: model.selectedTournamentID) {
            await model.loadSelectedTournament()
        }
        .sheet(item: $model.presentedSheet) { sheet in
            switch sheet {
            case .newTournament:
                NewTournamentSheet(model: model)
            case .editTournament:
                NewTournamentSheet(model: model, draft: model.localDraft(model.editingDraftID))
            }
        }
    }
}

private struct RegularTournamentShell: View {
    @Bindable var model: TournamentOSAppModel

    var body: some View {
        NavigationSplitView {
            TournamentSidebar(model: model)
                .navigationTitle("Competitions")
        } detail: {
            NavigationStack {
                VStack(spacing: 0) {
                    WorkspaceContextBar(model: model)
                    Divider()
                    Group {
                        if model.workspaceDestination == .portfolio {
                            PortfolioHomeView(model: model)
                        } else {
                            OrganiserFeatureView(section: model.selectedSection, model: model)
                        }
                    }
                    .navigationDestination(for: AppRoute.self) { route in
                        RouteDestinationView(route: route, model: model)
                    }
                    .toolbar {
                        WorkspaceToolbar(model: model)
                        RefreshToolbar(model: model)
                    }
                }
            }
        }
        .navigationSplitViewStyle(.prominentDetail)
    }
}

private struct CompactTournamentShell: View {
    @Bindable var model: TournamentOSAppModel

    var body: some View {
        TabView(selection: $model.selectedCompactTab) {
            ForEach(CompactTab.allCases) { tab in
                NavigationStack(path: model.pathBinding(for: tab)) {
                    CompactRootView(tab: tab, model: model)
                        .navigationTitle(tab.title)
                        .navigationDestination(for: AppRoute.self) { route in
                            RouteDestinationView(route: route, model: model)
                        }
                        .toolbar {
                            WorkspaceToolbar(model: model)
                            RefreshToolbar(model: model)
                        }
                }
                .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                .tag(tab)
                .accessibilityLabel(tab.title)
            }
        }
    }
}

private struct WorkspaceToolbar: ToolbarContent {
    let model: TournamentOSAppModel

    var body: some ToolbarContent {
        if model.workspaceDestination == .tournament {
            ToolbarItem(placement: .navigation) {
                Button { model.showPortfolio() } label: {
                    Label("All competitions", systemImage: "square.grid.2x2")
                }
                .accessibilityHint("Returns to the competitions portfolio")
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Button { model.beginTournamentCreation() } label: {
                Label("New competition", systemImage: "plus")
            }
            .keyboardShortcut("n", modifiers: .command)
        }
    }
}

private struct RefreshToolbar: ToolbarContent {
    let model: TournamentOSAppModel

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                Task { await model.refresh() }
            } label: {
                Label("Refresh tournament", systemImage: "arrow.clockwise")
            }
            .labelStyle(.iconOnly)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .keyboardShortcut("r", modifiers: .command)
            .accessibilityLabel("Refresh tournament data")
            .accessibilityHint("Reloads the selected tournament from the server")
        }
    }
}

public struct DemoTournamentAPIClient: TournamentAPIClient {
    private let profile: DemoWorkspaceProfile

    public init() { profile = .playAndKonnect }
    fileprivate init(profile: DemoWorkspaceProfile) { self.profile = profile }
    public var workspaceKind: TournamentWorkspaceKind { .demo }

    public func fetchPortfolio() async throws -> PortfolioDTO {
        PortfolioDTO(apiVersion: "1.0", items: profile.portfolio)
    }

    public func fetchBlueprint(tournamentID: String) async throws -> BlueprintSummaryDTO {
        BlueprintSummaryDTO(apiVersion: "1.0", id: tournamentID, name: profile.competitionName, revision: 8,
                            certificationStatus: .certified, solverStatus: .feasible, participantCount: profile.participantCount,
                            actualContestCount: profile.contestCount, scheduledContestCount: profile.contestCount, actionRequired: true)
    }

    public func fetchSchedule(tournamentID: String) async throws -> ScheduleDTO {
        ScheduleDTO(apiVersion: "1.0", tournamentID: tournamentID, timezone: "Europe/Athens",
                    solverStatus: .feasible, objectiveValueMinutes: 450, lowerBoundMinutes: 440,
                    optimalityGap: 0.0227, items: [
                        ScheduleItemDTO(id: "advanced.pool.1", resourceID: "Court 1",
                                        start: "2026-09-05T12:00:00+03:00", end: "2026-09-05T12:30:00+03:00",
                                        possibleEntrantIDs: ["Advanced 1", "Advanced 2"],
                                        accessibilityLabel: "Advanced pool match on Court 1 at noon"),
                    ])
    }

    public func fetchLiveControlRoom(tournamentID: String) async throws -> LiveControlRoomDTO {
        LiveControlRoomDTO(
            apiVersion: "1.0", tournamentID: tournamentID, revision: 8,
            asOf: "2026-09-05T12:05:00+03:00", timezone: "Europe/Athens",
            summary: LiveControlRoomSummaryDTO(now: 1, next: 1, late: 1, blocked: 1, unreported: 1),
            items: [
                LiveControlRoomItemDTO(
                    id: "operation-M21", contestID: "M21", status: .now,
                    title: "Intermediate pool · Round 2", statusText: "On court now",
                    detail: "Play is in progress", resourceID: "Court 1",
                    scheduledStart: "2026-09-05T12:00:00+03:00",
                    participantNames: ["Intermediate Pair 3", "Intermediate Pair 7"],
                    accessibilityLabel: "Now, Intermediate pool round 2, on Court 1"
                ),
                LiveControlRoomItemDTO(
                    id: "operation-M22", contestID: "M22", status: .next,
                    title: "Advanced pool · Round 3", statusText: "Up next",
                    detail: "Both pairs checked in", resourceID: "Court 2",
                    scheduledStart: "2026-09-05T12:30:00+03:00",
                    participantNames: ["Advanced Pair 1", "Advanced Pair 4"],
                    accessibilityLabel: "Next, Advanced pool round 3, Court 2 at 12:30"
                ),
                LiveControlRoomItemDTO(
                    id: "operation-M18", contestID: "M18", status: .late,
                    title: "Beginner pool · Round 2", statusText: "12 minutes late",
                    detail: "Waiting for one pair", resourceID: "Court 3",
                    scheduledStart: "2026-09-05T11:53:00+03:00",
                    participantNames: ["Beginner Pair 5", "Beginner Pair 9"],
                    accessibilityLabel: "Late, Beginner pool round 2, 12 minutes late, Court 3"
                ),
                LiveControlRoomItemDTO(
                    id: "operation-M24", contestID: "M24", status: .blocked,
                    title: "Intermediate pool · Round 3", statusText: "Blocked",
                    detail: "Court inspection in progress", resourceID: "Court 4",
                    scheduledStart: "2026-09-05T12:30:00+03:00",
                    participantNames: ["Intermediate Pair 2", "Intermediate Pair 8"],
                    accessibilityLabel: "Blocked, Intermediate pool round 3, Court 4 inspection in progress"
                ),
                LiveControlRoomItemDTO(
                    id: "operation-M17", contestID: "M17", status: .unreported,
                    title: "Advanced pool · Round 2", statusText: "Result unreported",
                    detail: "Score has not reached the control room", resourceID: "Court 5",
                    scheduledStart: "2026-09-05T11:30:00+03:00",
                    participantNames: ["Advanced Pair 6", "Advanced Pair 10"],
                    accessibilityLabel: "Unreported, Advanced pool round 2, result missing from Court 5"
                ),
            ]
        )
    }

    public func fetchFindings(tournamentID: String) async throws -> FindingsDTO {
        FindingsDTO(apiVersion: "1.0", tournamentID: tournamentID, items: [
            FindingDTO(id: "rest-preference", code: "TSW104", severity: .warning,
                       path: "/operationalPolicies/minimum.matches",
                       message: "One three-team pool cannot meet the preferred three group matches.",
                       accessibilityLabel: "Warning: preferred minimum group matches cannot be met",
                       debugID: "demo-finding-rest"),
        ])
    }

    public func fetchCertification(tournamentID: String) async throws -> CertificationDTO {
        CertificationDTO(apiVersion: "1.0", tournamentID: tournamentID, status: .certified,
                         statement: "All registered hard invariants passed.",
                         certificationHash: String(repeating: "c", count: 64),
                         proofIDs: ["graph": "graph-proof", "schedule": "schedule-proof"])
    }
}

fileprivate enum DemoWorkspaceProfile: Sendable {
    case playAndKonnect
    case sundayCrew
    case xgLeagues

    var competitionName: String {
        switch self {
        case .playAndKonnect: "Play & Konnect Padel Tournament"
        case .sundayCrew: "Sunday Pickleball Sprint"
        case .xgLeagues: "xG Autumn League"
        }
    }

    var participantCount: Int {
        switch self { case .playAndKonnect: 47; case .sundayCrew: 12; case .xgLeagues: 96 }
    }

    var contestCount: Int {
        switch self { case .playAndKonnect: 98; case .sundayCrew: 18; case .xgLeagues: 144 }
    }

    var portfolio: [PortfolioTournamentDTO] {
        let id: String
        switch self {
        case .playAndKonnect: id = "play-and-konnect"
        case .sundayCrew: id = "sunday-pickleball"
        case .xgLeagues: id = "xg-autumn-league"
        }
        return [PortfolioTournamentDTO(id: id, name: competitionName, revision: 8, certificationStatus: .certified)]
    }
}

private func demoWorkspaceSessions() -> [TournamentWorkspaceSession] {
    [
        TournamentWorkspaceSession(
            workspace: CompetitionWorkspaceSummaryDTO(
                id: "play-and-konnect", name: "Play & Konnect", kind: .club,
                roleName: "Owner", publicHost: "play-and-konnect.krateasy.com", isLocalPreview: true
            ),
            client: DemoTournamentAPIClient(profile: .playAndKonnect)
        ),
        TournamentWorkspaceSession(
            workspace: CompetitionWorkspaceSummaryDTO(
                id: "sunday-crew", name: "Sunday Crew", kind: .personal,
                roleName: "Organiser", publicHost: "sunday-crew.krateasy.com", isLocalPreview: true
            ),
            client: DemoTournamentAPIClient(profile: .sundayCrew)
        ),
        TournamentWorkspaceSession(
            workspace: CompetitionWorkspaceSummaryDTO(
                id: "xg-leagues", name: "xG Leagues", kind: .league,
                roleName: "League director", publicHost: "xgleagues.krateasy.com", isLocalPreview: true
            ),
            client: DemoTournamentAPIClient(profile: .xgLeagues)
        ),
    ]
}

#Preview("Krateasy Competitions – Mac") {
    TournamentOSAppShell()
        .frame(minWidth: 900, minHeight: 640)
}

#Preview("Krateasy Competitions – iPhone") {
    TournamentOSAppShell()
        .environment(\.horizontalSizeClass, .compact)
}
