import SwiftUI

enum CompetitionTheme {
    static let accent = Color(red: 0.04, green: 0.43, blue: 0.31)
    static let accentSoft = accent.opacity(0.11)
    static let warm = Color(red: 0.97, green: 0.96, blue: 0.93)
    static let corner: CGFloat = 18
    static let contentWidth: CGFloat = 1180
}

struct TournamentSidebar: View {
    @Bindable var model: TournamentOSAppModel

    private let primary: [OrganiserSection] = [.today, .operations, .schedule, .participants]
    private let manage: [OrganiserSection] = [.event, .competition, .scenarios, .certification]

    var body: some View {
        VStack(spacing: 0) {
            BrandLockup()
                .padding(.horizontal, 14)
                .padding(.top, 16)

            WorkspaceSwitcher(model: model)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

            List {
                Section("Workspace") {
                    Button { model.showPortfolio() } label: {
                        Label("All competitions", systemImage: "square.grid.2x2")
                            .font(.subheadline.weight(model.workspaceDestination == .portfolio ? .semibold : .regular))
                            .foregroundStyle(model.workspaceDestination == .portfolio ? CompetitionTheme.accent : .primary)
                            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(model.workspaceDestination == .portfolio ? CompetitionTheme.accentSoft : .clear)
                    )

                    Button { model.beginTournamentCreation() } label: {
                        Label("New competition", systemImage: "plus.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(CompetitionTheme.accent)
                            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut("n", modifiers: .command)
                }

                if model.workspaceDestination == .tournament {
                    Section("Current competition") { TournamentPicker(model: model) }
                    Section("Operate") {
                        ForEach(primary) { SidebarRow(section: $0, model: model) }
                    }
                    Section("Design & verify") {
                        ForEach(manage) { SidebarRow(section: $0, model: model) }
                    }
                }

                Section { SidebarRow(section: .settings, model: model) }
            }
            .listStyle(.sidebar)

            HStack(spacing: 8) {
                Circle().fill(model.isDemoWorkspace ? Color.orange : Color.green).frame(width: 7, height: 7)
                Text(model.isDemoWorkspace ? "Local preview · \(model.activeWorkspace.roleName)" : "Connected · \(model.activeWorkspace.roleName)")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
            .padding(16)
            .accessibilityElement(children: .combine)
        }
        .navigationSplitViewColumnWidth(min: 232, ideal: 264, max: 310)
    }
}

private struct WorkspaceSwitcher: View {
    @Bindable var model: TournamentOSAppModel

    var body: some View {
        Menu {
            ForEach(model.availableWorkspaces) { workspace in
                Button {
                    model.selectWorkspace(workspace.id)
                } label: {
                    if workspace.id == model.selectedWorkspaceID {
                        Label(workspace.name, systemImage: "checkmark")
                    } else {
                        Text(workspace.name)
                    }
                }
            }
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(CompetitionTheme.accentSoft)
                    .frame(width: 34, height: 34)
                    .overlay {
                        Image(systemName: model.activeWorkspace.kind.systemImage)
                            .foregroundStyle(CompetitionTheme.accent)
                    }
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.activeWorkspace.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(model.activeWorkspace.kind.displayName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 2)
                Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.bold)).foregroundStyle(.tertiary)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Current workspace, \(model.activeWorkspace.name)")
        .accessibilityHint("Choose another organisation workspace")
    }
}

struct WorkspaceContextBar: View {
    let model: TournamentOSAppModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: model.activeWorkspace.kind.systemImage)
                .foregroundStyle(CompetitionTheme.accent)
                .accessibilityHidden(true)
            Text(model.activeWorkspace.name).font(.subheadline.weight(.semibold))
            if let competition = model.selectedCompetitionName, model.workspaceDestination == .tournament {
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary).accessibilityHidden(true)
                Text(competition).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary).accessibilityHidden(true)
                Text(model.selectedSection.title).font(.subheadline).foregroundStyle(.secondary)
            } else {
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary).accessibilityHidden(true)
                Text("Portfolio").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if let host = model.activeWorkspace.publicHost {
                Label(host, systemImage: "globe").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 46)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(contextLabel)
    }

    private var contextLabel: String {
        if let competition = model.selectedCompetitionName, model.workspaceDestination == .tournament {
            return "Workspace \(model.activeWorkspace.name), competition \(competition), \(model.selectedSection.title)"
        }
        return "Workspace \(model.activeWorkspace.name), competition portfolio"
    }
}

private struct BrandLockup: View {
    var body: some View {
        HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous).fill(CompetitionTheme.accent)
                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(width: 38, height: 38)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                Text("Krateasy").font(.headline.weight(.bold))
                Text("Competitions").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Krateasy Competitions")
    }
}

private struct TournamentPicker: View {
    @Bindable var model: TournamentOSAppModel

    var body: some View {
        LoadStateView(state: model.portfolioState, retry: {
            Task { await model.loadPortfolio() }
        }) { portfolio in
            if portfolio.items.isEmpty {
                Text("No competitions").foregroundStyle(.secondary)
            } else {
                Menu {
                    ForEach(portfolio.items) { tournament in
                        Button {
                            model.openTournament(tournament.id)
                        } label: {
                            if tournament.id == model.selectedTournamentID {
                                Label(tournament.name, systemImage: "checkmark")
                            } else {
                                Text(tournament.name)
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(CompetitionTheme.accentSoft)
                            .frame(width: 32, height: 32)
                            .overlay {
                                Image(systemName: "trophy.fill").font(.caption).foregroundStyle(CompetitionTheme.accent)
                            }
                        Text(selectedName(in: portfolio))
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 2)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption2.weight(.bold)).foregroundStyle(.tertiary)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
        .accessibilityLabel("Selected competition, \(selectedName(in: portfolio))")
        .accessibilityHint("Choose another competition")
            }
        }
    }

    private func selectedName(in portfolio: PortfolioDTO) -> String {
        portfolio.items.first(where: { $0.id == model.selectedTournamentID })?.name ?? "Choose tournament"
    }
}

private struct SidebarRow: View {
    let section: OrganiserSection
    @Bindable var model: TournamentOSAppModel

    var body: some View {
        Button {
            model.selectedSection = section
            model.workspaceDestination = .tournament
        } label: {
            Label(section.title, systemImage: section.systemImage)
                .font(.subheadline.weight(model.selectedSection == section ? .semibold : .regular))
                .foregroundStyle(model.selectedSection == section ? CompetitionTheme.accent : .primary)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(model.selectedSection == section ? CompetitionTheme.accentSoft : .clear)
        )
        .accessibilityAddTraits(model.selectedSection == section ? .isSelected : [])
    }
}

struct PortfolioHomeView: View {
    let model: TournamentOSAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .bottom, spacing: 24) {
                        portfolioHeading
                        Spacer(minLength: 20)
                        createButton
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        portfolioHeading
                        createButton
                    }
                }

                if model.isDemoWorkspace {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "sparkles").foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Demo workspace").font(.subheadline.weight(.semibold))
                            Text("Explore this workspace or create a draft that stays on this Mac. Connect a server before running a real competition.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background(Color.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityElement(children: .combine)
                }

                CompetitionStartPaths(model: model)

                LoadStateView(state: model.portfolioState, retry: {
                    Task { await model.loadPortfolio() }
                }) { portfolio in
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .firstTextBaseline) {
                            EyebrowTitle("Your competitions", detail: "Choose one to plan or operate")
                            Spacer()
                            Text(portfolio.items.count.formatted()).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }

                        if portfolio.items.isEmpty {
                            ContentUnavailableView {
                                Label("No competitions yet", systemImage: "trophy")
                            } description: {
                                Text("Create a draft and work through participants, format, rules, resources, and review.")
                            } actions: {
                                Button("Create competition") { model.beginTournamentCreation() }
                                    .buttonStyle(.borderedProminent)
                            }
                            .frame(minHeight: 260)
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 14)], spacing: 14) {
                                ForEach(portfolio.items) { tournament in
                                    TournamentPortfolioCard(
                                        tournament: tournament,
                                        isLocalDraft: model.isLocalDraft(tournament.id)
                                    ) {
                                        model.openTournament(tournament.id)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .pageFrame()
        }
        .background(Color.primary.opacity(0.025))
        .navigationTitle("Competitions")
    }

    private var portfolioHeading: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("KRATEASY COMPETITIONS").font(.caption2.weight(.bold)).tracking(1.4).foregroundStyle(CompetitionTheme.accent)
            Text("Plan it. Run it. Recover fast.").font(.largeTitle.weight(.bold))
            Text("Tournaments, leagues and difficult multi-stage events start here. Nothing is published until you approve it.")
                .font(.body).foregroundStyle(.secondary)
        }
    }

    private var createButton: some View {
        Button { model.beginTournamentCreation() } label: {
            Label("New competition", systemImage: "plus")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 32)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }
}

private struct CompetitionStartPaths: View {
    let model: TournamentOSAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            EyebrowTitle("Start from the job", detail: "One engine, the right amount of setup")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                ForEach(CompetitionStartPreset.allCases) { preset in
                    Button {
                        model.beginTournamentCreation(preset: preset)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: preset.systemImage).foregroundStyle(CompetitionTheme.accent)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(preset.title).font(.subheadline.weight(.semibold))
                                Text(preset.detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
                        .background(CompetitionTheme.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Starts a guided competition draft")
                }
            }
        }
    }
}

private struct TournamentPortfolioCard: View {
    let tournament: PortfolioTournamentDTO
    let isLocalDraft: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 11, style: .continuous).fill(CompetitionTheme.accentSoft)
                        Image(systemName: isLocalDraft ? "doc.badge.clock" : "trophy.fill")
                            .font(.headline).foregroundStyle(CompetitionTheme.accent)
                    }
                    .frame(width: 42, height: 42)
                    Spacer()
                    Text(isLocalDraft ? "Draft" : tournament.certificationStatus.accessibleTitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isLocalDraft ? Color.orange : CompetitionTheme.accent)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(tournament.name).font(.headline).multilineTextAlignment(.leading).lineLimit(2)
                    Text(isLocalDraft ? "Saved on this Mac · Not published" : "Revision \(tournament.revision) · Ready to open")
                        .font(.caption).foregroundStyle(.secondary)
                }
                HStack {
                    Text(isLocalDraft ? "Continue setup" : "Open tournament").font(.subheadline.weight(.semibold))
                    Spacer()
                    Image(systemName: "arrow.right").foregroundStyle(.secondary)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous).stroke(Color.primary.opacity(0.08)) }
            .contentShape(RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(tournament.name), \(isLocalDraft ? "local draft" : tournament.certificationStatus.accessibleTitle)")
        .accessibilityHint("Opens this tournament")
    }
}

struct NewTournamentSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let model: TournamentOSAppModel
    let draft: LocalTournamentDraft?

    @State private var step = 0
    @State private var entryMode = "Quick setup"
    @State private var description = ""
    @State private var name = ""
    @State private var clubName = ""
    @State private var startsAt = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var sport = "Padel"
    @State private var participantCount = 16
    @State private var participantUnit = "Pairs"
    @State private var formatName = "Pools → knockout"
    @State private var minimumRestMinutes = 30
    @State private var courtCount = 4
    @State private var priority = "Protect player rest"
    @State private var validationMessage: String?
    @State private var isSubmitting = false
    @State private var journeyDraft: CompetitionJourneyDTO?
    @State private var interpretationReviewed = false

    private let steps = ["Basics", "People", "Format", "Rules", "Resources", "Review"]

    init(model: TournamentOSAppModel, draft: LocalTournamentDraft? = nil) {
        self.model = model
        self.draft = draft
        let defaults = model.creationPreset.defaults
        _name = State(initialValue: draft?.name ?? "")
        _clubName = State(initialValue: draft?.clubName ?? model.activeWorkspace.name)
        _startsAt = State(initialValue: draft?.startsAt ?? (Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()))
        _sport = State(initialValue: draft?.sport ?? defaults.sport)
        _participantCount = State(initialValue: draft?.participantCount ?? (model.isDemoWorkspace ? defaults.participantCount : 47))
        _formatName = State(initialValue: draft?.formatName ?? defaults.formatName)
        _minimumRestMinutes = State(initialValue: draft?.minimumRestMinutes ?? (model.isDemoWorkspace ? defaults.minimumRestMinutes : 0))
        _courtCount = State(initialValue: draft?.courtCount ?? (model.isDemoWorkspace ? defaults.resourceCount : 7))
        _priority = State(initialValue: draft?.priority ?? (model.isDemoWorkspace ? defaults.priority : "Finish on time"))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, title in
                            Button {
                                if index <= step { move(to: index) }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: index < step ? "checkmark.circle.fill" : "\(index + 1).circle.fill")
                                    Text(title)
                                }
                                .font(.caption.weight(index == step ? .semibold : .regular))
                                .foregroundStyle(index <= step ? CompetitionTheme.accent : .secondary)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 36)
                                .background(index == step ? CompetitionTheme.accentSoft : .clear, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(index > step)
                            .accessibilityAddTraits(index == step ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                }
                Divider()

                Form {
                    stepContent
                    if let validationMessage {
                        Section { Label(validationMessage, systemImage: "exclamationmark.circle").foregroundStyle(.red) }
                    }
                }
                .formStyle(.grouped)

                Divider()
                HStack {
                    Button("Cancel") { dismiss() }
                    Spacer()
                    if step > 0 { Button("Back") { move(to: step - 1) } }
                    if step < steps.count - 1 {
                        Button("Continue") { continueForward() }.buttonStyle(.borderedProminent)
                    } else {
                        Button(finalActionTitle) {
                            Task { await performFinalAction() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isSubmitting)
                    }
                }
                .padding(16)
            }
            .navigationTitle(draft == nil ? "New competition" : "Edit competition draft")
            #if os(macOS)
            .frame(minWidth: 680, minHeight: 560)
            #endif
        }
        .interactiveDismissDisabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
    }

    @ViewBuilder private var stepContent: some View {
        switch step {
        case 0:
            Section(model.creationPreset.title) {
                Picker("Start from", selection: $entryMode) {
                    Text("Quick setup").tag("Quick setup")
                    Text("Describe it").tag("Describe it")
                }
                .pickerStyle(.segmented)
                if entryMode == "Describe it" {
                    TextEditor(text: $description)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Competition description")
                    Text("The local deterministic interpreter extracts only registered facts and stops for anything missing or unsupported.")
                        .foregroundStyle(.secondary)
                }
                TextField("Competition name", text: $name, prompt: Text("Autumn championship"))
                TextField("Organiser or group", text: $clubName)
                DatePicker("Starts", selection: $startsAt)
                Picker("Sport", selection: $sport) {
                    ForEach(["Padel", "Pickleball", "Badminton", "Squash", "Tennis", "Golf", "Other"], id: \.self) { Text($0) }
                }
            }
            Section { Text("This creates a private draft. Publication is a separate, verified action.").foregroundStyle(.secondary) }
        case 1:
            Section("Participants") {
                Picker("Entrant unit", selection: $participantUnit) {
                    ForEach(["Pairs", "Teams", "Players", "Athletes"], id: \.self) { Text($0) }
                }
                Stepper(value: $participantCount, in: 2...4096) {
                    LabeledContent("Expected \(participantUnit.lowercased())", value: participantCount.formatted())
                }
                Text("You can import, invite, or select exact people after the draft is created.").foregroundStyle(.secondary)
            }
        case 2:
            Section("Format") {
                Picker("Starting point", selection: $formatName) {
                    ForEach(["Pools → knockout", "Round robin", "League table", "Single elimination", "Double elimination", "Swiss", "Custom stage graph"], id: \.self) { Text($0) }
                }
                Text("The compiler will turn this choice into an explicit stage graph before anything can be published.").foregroundStyle(.secondary)
            }
        case 3:
            Section("Player protection") {
                Stepper(value: $minimumRestMinutes, in: 0...240, step: 5) {
                    LabeledContent("Minimum rest", value: "\(minimumRestMinutes) min")
                }
                Picker("Primary priority", selection: $priority) {
                    ForEach(["Protect player rest", "Finish on time", "Minimise court changes", "Maximise broadcast value"], id: \.self) { Text($0) }
                }
            }
        case 4:
            Section("Available resources") {
                Stepper(value: $courtCount, in: 1...128) {
                    LabeledContent(sport == "Golf" ? "Courses or starting groups" : "Courts", value: courtCount.formatted())
                }
                Text("You can name courts after sponsors, define opening windows, outages, accessibility, and court-specific restrictions next.").foregroundStyle(.secondary)
            }
        default:
            Section("Review") {
                LabeledContent("Competition", value: name.isEmpty ? "Not named" : name)
                LabeledContent("Organiser", value: clubName)
                LabeledContent("Sport", value: sport)
                LabeledContent("Participants", value: "\(participantCount) \(participantUnit.lowercased())")
                LabeledContent("Format", value: formatName)
                LabeledContent("Minimum rest", value: "\(minimumRestMinutes) min")
                LabeledContent("Resources", value: courtCount.formatted())
                LabeledContent("Priority", value: priority)
            }
            Section("Authority & evidence") {
                Label(model.isDemoWorkspace ? "Saved as a local draft · Nothing published" : "The server recompiles authoritative artefacts, runs Competition Guard, and binds an approval to that exact revision.", systemImage: "checkmark.shield.fill")
                    .foregroundStyle(CompetitionTheme.accent)
                if !model.isDemoWorkspace {
                    Text("Current verified milestone: 47 padel pairs · seven courts · approved mixed pools-to-knockout template · 30-minute standard slots · no mandatory rest.")
                        .foregroundStyle(.secondary)
                }
            }
            if let journeyDraft, interpretationReviewed {
                Section("What Krateasy understood") {
                    LabeledContent("Lifecycle", value: journeyDraft.status.replacingOccurrences(of: "_", with: " ").capitalized)
                    LabeledContent("Recognised fields", value: journeyDraft.understood.count.formatted())
                    if let blueprintName = journeyDraft.blueprint.name { LabeledContent("Name", value: blueprintName) }
                    if let count = journeyDraft.blueprint.participantCount, let unit = journeyDraft.blueprint.participantUnit {
                        LabeledContent("Entrants", value: "\(count) \(unit)")
                    }
                    ForEach(journeyDraft.questions) { question in
                        VStack(alignment: .leading, spacing: 4) {
                            Label(question.prompt, systemImage: question.blocking ? "questionmark.circle.fill" : "info.circle")
                            Text(question.why).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(journeyDraft.supportFindings, id: \.self) { finding in
                        Label(finding, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                }
                Section("Assumptions & provenance") {
                    ForEach(journeyDraft.assumptions.prefix(8)) { assumption in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(assumption.rulePath).font(.callout.weight(.medium))
                            Text("\(assumption.knowledge.capitalized) · \(assumption.origin.replacingOccurrences(of: "_", with: " "))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if journeyDraft.assumptions.count > 8 {
                        Text("+ \(journeyDraft.assumptions.count - 8) more hash-bound rule decisions")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let compiled = journeyDraft.compiled {
                    Section("Competition Guard") {
                        Label(compiled.guardStatus, systemImage: compiled.guardStatus == "PASSED" ? "checkmark.seal.fill" : "xmark.octagon.fill")
                            .foregroundStyle(compiled.guardStatus == "PASSED" ? CompetitionTheme.accent : .red)
                        Text("Operational findings requiring acknowledgement: \(compiled.requiredAcknowledgementCodes.joined(separator: ", "))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var finalActionTitle: String {
        if model.isDemoWorkspace { return draft == nil ? "Create local draft" : "Save changes" }
        guard interpretationReviewed, let journeyDraft else { return "Review interpretation" }
        switch journeyDraft.status {
        case "DRAFT": return "Compile & run Guard"
        case "READY_FOR_APPROVAL": return "Approve exact revision"
        case "PUBLISHED": return "Open web experience"
        default: return "Edit required decisions"
        }
    }

    private func continueForward() {
        validationMessage = nil
        if step == 0 {
            if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                validationMessage = "Give the competition a name before continuing."
                return
            }
            if clubName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                validationMessage = "Choose or name the organiser or group."
                return
            }
        }
        move(to: min(step + 1, steps.count - 1))
    }

    private func move(to newStep: Int) {
        validationMessage = nil
        if newStep < steps.count - 1 { interpretationReviewed = false }
        withAnimation(.snappy) { step = newStep }
    }

    @MainActor private func performFinalAction() async {
        let savedDraft = LocalTournamentDraft(
            id: draft?.id ?? "local.\(UUID().uuidString.lowercased())",
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            clubName: clubName.trimmingCharacters(in: .whitespacesAndNewlines),
            startsAt: startsAt,
            sport: sport,
            participantCount: participantCount,
            formatName: formatName,
            courtCount: courtCount,
            minimumRestMinutes: minimumRestMinutes,
            priority: priority
        )
        if model.isDemoWorkspace {
            model.saveLocalDraft(savedDraft)
            dismiss()
            return
        }
        if entryMode == "Describe it" && description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            validationMessage = "Describe the competition before asking the deterministic interpreter to review it."
            return
        }
        isSubmitting = true
        validationMessage = nil
        let formatter = ISO8601DateFormatter()
        let finish = Calendar.current.date(byAdding: .hour, value: 8, to: startsAt) ?? startsAt
        let input = CompetitionCreationInput(
            name: savedDraft.name,
            sport: sport.lowercased(),
            participantUnit: participantUnit.lowercased(),
            participantCount: participantCount,
            resourceCount: courtCount,
            resourceLabel: sport == "Golf" ? "courses" : "courts",
            format: formatName == "Pools → knockout" ? "pools_to_knockout" : formatName.lowercased().replacingOccurrences(of: " ", with: "_"),
            poolSize: 4,
            qualifiersPerPool: 1,
            minimumMatches: 3,
            minimumRestMinutes: minimumRestMinutes,
            matchDurationMinutes: 30,
            startsAt: formatter.string(from: startsAt),
            endsAt: formatter.string(from: finish),
            priority: priority == "Finish on time" ? "finish_on_time" : priority == "Minimise court changes" ? "minimum_disruption" : "fair_recovery"
        )
        let source: CompetitionCreationSourceInput = entryMode == "Describe it"
            ? .language(description.trimmingCharacters(in: .whitespacesAndNewlines))
            : .quick(input)
        do {
            if !interpretationReviewed {
                journeyDraft = try await model.reviewCompetitionDraft(source, replacing: journeyDraft)
                interpretationReviewed = true
            } else if journeyDraft?.status == "DRAFT", let journeyDraft {
                self.journeyDraft = try await model.compileCompetitionDraft(journeyDraft)
            } else if journeyDraft?.status == "READY_FOR_APPROVAL", let journeyDraft {
                let result = try await model.approveCompetitionRevision(journeyDraft)
                self.journeyDraft = result
                if let url = model.competitionWebURL(for: result.webPath) { openURL(url) }
                dismiss()
            } else if journeyDraft?.status == "PUBLISHED", let journeyDraft,
                      let url = model.competitionWebURL(for: journeyDraft.webPath) {
                openURL(url)
                dismiss()
            } else {
                validationMessage = "Return to the earlier steps and resolve every required question before compilation."
            }
            isSubmitting = false
        } catch {
            validationMessage = "Stopped safely: \(error.localizedDescription) Check every required fact and the verified milestone envelope."
            isSubmitting = false
        }
    }
}

private struct TournamentRequiredView<Content: View>: View {
    let model: TournamentOSAppModel
    @ViewBuilder let content: () -> Content

    var body: some View {
        if model.workspaceDestination == .tournament, model.selectedTournamentID != nil {
            content()
        } else {
            ContentUnavailableView {
                Label("Choose a competition", systemImage: "trophy")
            } description: {
                Text("Open an existing competition or create a new draft first.")
            } actions: {
                Button("View competitions") {
                    model.showPortfolio()
                    model.selectedCompactTab = .home
                }
                Button("New competition") { model.beginTournamentCreation() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}

struct OrganiserFeatureView: View {
    let section: OrganiserSection
    let model: TournamentOSAppModel

    var body: some View {
        Group {
            switch section {
            case .today: HomeView(model: model)
            case .operations: LiveOperationsView(model: model)
            case .event: EventView(model: model)
            case .schedule: ScheduleView(model: model)
            case .participants: ParticipantsView(model: model)
            case .competition: CompetitionView(model: model)
            case .findings: FindingsView(model: model)
            case .scenarios: ScenariosView(model: model)
            case .certification: CertificationView(model: model)
            case .settings: SettingsView()
            }
        }
        .navigationTitle(section.title)
    }
}

struct CompactRootView: View {
    let tab: CompactTab
    let model: TournamentOSAppModel

    var body: some View {
        switch tab {
        case .home:
            if model.workspaceDestination == .portfolio { PortfolioHomeView(model: model) }
            else { HomeView(model: model) }
        case .run:
            TournamentRequiredView(model: model) { LiveOperationsView(model: model) }
        case .schedule:
            TournamentRequiredView(model: model) { ScheduleView(model: model) }
        case .people:
            TournamentRequiredView(model: model) { ParticipantsView(model: model) }
        case .more:
            TournamentRequiredView(model: model) { MoreView(model: model) }
        }
    }
}

struct RouteDestinationView: View {
    let route: AppRoute
    let model: TournamentOSAppModel

    var body: some View {
        switch route {
        case .operations: LiveOperationsView(model: model).navigationTitle("Run event")
        case .event: EventView(model: model).navigationTitle("Overview")
        case .schedule: ScheduleView(model: model).navigationTitle("Schedule")
        case .scheduleItem(let id): ScheduleItemDetailView(id: id, model: model)
        case .findings: FindingsView(model: model).navigationTitle("Issues")
        case .finding(let id): FindingDetailView(id: id, model: model)
        case .certification: CertificationView(model: model).navigationTitle("Evidence")
        case .participants: ParticipantsView(model: model).navigationTitle("People")
        case .competition: CompetitionView(model: model).navigationTitle("Format & rules")
        case .scenarios: ScenariosView(model: model).navigationTitle("What-if plans")
        case .settings: SettingsView().navigationTitle("Settings")
        }
    }
}

private struct HomeView: View {
    let model: TournamentOSAppModel

    var body: some View {
        if let draft = model.localDraft(model.selectedTournamentID) {
            LocalDraftHomeView(draft: draft, model: model)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HomeHeader(model: model)
                    PriorityPanel(model: model)

                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 24) {
                            VStack(alignment: .leading, spacing: 24) {
                                RunningNowPanel(model: model)
                                UpcomingPanel(model: model)
                            }
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                            TournamentMap(model: model).frame(width: 330)
                        }
                        VStack(alignment: .leading, spacing: 24) {
                            TournamentMap(model: model)
                            RunningNowPanel(model: model)
                            UpcomingPanel(model: model)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
                .frame(maxWidth: CompetitionTheme.contentWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Color.primary.opacity(0.025))
        }
    }
}

private struct LocalDraftHomeView: View {
    let draft: LocalTournamentDraft
    let model: TournamentOSAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                LocalDraftBanner()
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .bottom, spacing: 20) {
                        heading
                        Spacer()
                        editButton
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        heading
                        editButton
                    }
                }

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 18) {
                        DraftSummary(draft: draft).frame(maxWidth: .infinity)
                        DraftNextSteps(model: model).frame(maxWidth: .infinity)
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        DraftSummary(draft: draft)
                        DraftNextSteps(model: model)
                    }
                }
            }
            .pageFrame()
        }
        .background(Color.primary.opacity(0.025))
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("DRAFT").font(.caption2.weight(.bold)).tracking(1.4).foregroundStyle(.orange)
            Text(draft.name).font(.largeTitle.weight(.bold))
            Text("Set the truth first. The compiler and schedule come next.").foregroundStyle(.secondary)
        }
    }

    private var editButton: some View {
        Button { model.beginEditingDraft(draft.id) } label: {
            Label("Edit setup", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }
}

private struct DraftSummary: View {
    let draft: LocalTournamentDraft
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            EyebrowTitle("Setup summary", detail: draft.clubName)
            LabeledContent("Sport", value: draft.sport)
            Divider()
            LabeledContent("Participants", value: draft.participantCount.formatted())
            Divider()
            LabeledContent("Format", value: draft.formatName)
            Divider()
            LabeledContent("Minimum rest", value: "\(draft.minimumRestMinutes) min")
            Divider()
            LabeledContent("Resources", value: draft.courtCount.formatted())
        }
        .surfaceStyle()
    }
}

private struct DraftNextSteps: View {
    let model: TournamentOSAppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            EyebrowTitle("Next", detail: "Private until you approve publication")
            DraftStep(number: 1, title: "Confirm people and eligibility") { model.selectedSection = .participants }
            DraftStep(number: 2, title: "Compile format and rules") { model.selectedSection = .competition }
            DraftStep(number: 3, title: "Generate and stress-test schedule") { model.selectedSection = .schedule }
            DraftStep(number: 4, title: "Review evidence, then publish") { model.selectedSection = .certification }
        }
        .surfaceStyle()
    }
}

private struct DraftStep: View {
    let number: Int
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "\(number).circle.fill").foregroundStyle(.secondary)
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct LocalDraftBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.doc.fill").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 3) {
                Text("Local draft · not live").font(.subheadline.weight(.semibold))
                Text("This setup is saved on this Mac. Compile, verify, and connect a production workspace before inviting players or running the event.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(Color.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct HomeHeader: View {
    let model: TournamentOSAppModel

    var body: some View {
        LoadStateView(state: model.blueprintState, retry: retry) { blueprint in
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    heading(blueprint)
                    Spacer(minLength: 12)
                    shareButton(blueprint)
                }
                VStack(alignment: .leading, spacing: 6) {
                    heading(blueprint)
                    shareButton(blueprint)
                }
            }
        }
    }

    private func heading(_ blueprint: BlueprintSummaryDTO) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("GOOD AFTERNOON").font(.caption2.weight(.bold)).tracking(1.4).foregroundStyle(CompetitionTheme.accent)
            Text(blueprint.name).font(.largeTitle.weight(.bold)).lineLimit(2)
            Text("Everything important, in the order it needs you.").font(.body).foregroundStyle(.secondary)
        }
    }

    private func shareButton(_ blueprint: BlueprintSummaryDTO) -> some View {
        ShareLink(item: "\(blueprint.name): \(blueprint.participantCount) players, \(blueprint.scheduledContestCount) matches scheduled.") {
            Label("Share update", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(.bordered)
        .accessibilityHint("Shares a plain-language tournament update")
    }

    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct PriorityPanel: View {
    let model: TournamentOSAppModel

    var body: some View {
        LoadStateView(state: model.operationsState, retry: retry) { operations in
            let priority = operations.items.first(where: { $0.status == .blocked })
                ?? operations.items.first(where: { $0.status == .late })
                ?? operations.items.first(where: { $0.status == .unreported })

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 16) {
                    PriorityMessage(priority: priority)
                    Spacer(minLength: 8)
                    PriorityAction(priority: priority)
                }
                VStack(alignment: .leading, spacing: 16) {
                    PriorityMessage(priority: priority)
                    PriorityAction(priority: priority).frame(maxWidth: .infinity)
                }
            }
            .padding(20)
            .background(CompetitionTheme.warm.gradient, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.primary.opacity(0.07)) }
            .accessibilityElement(children: .contain)
        }
    }

    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct PriorityMessage: View {
    let priority: LiveControlRoomItemDTO?
    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(priority == nil ? CompetitionTheme.accentSoft : Color.orange.opacity(0.14))
                Image(systemName: priority == nil ? "checkmark" : "exclamationmark")
                    .font(.title3.weight(.bold)).foregroundStyle(priority == nil ? CompetitionTheme.accent : Color.orange)
            }
            .frame(width: 48, height: 48)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(priority == nil ? "You’re clear" : "One thing needs you")
                    .font(.title2.weight(.bold)).foregroundStyle(Color.black.opacity(0.88))
                if let priority {
                    Text([priority.resourceID, priority.detail].compactMap { $0 }.joined(separator: " · "))
                        .foregroundStyle(Color.black.opacity(0.62))
                } else {
                    Text("No blocked, late, or missing results right now.").foregroundStyle(Color.black.opacity(0.62))
                }
            }
        }
    }
}

private struct PriorityAction: View {
    let priority: LiveControlRoomItemDTO?
    var body: some View {
        NavigationLink(value: AppRoute.operations) {
            Text(priority == nil ? "Open control room" : "Resolve in control room")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(minHeight: 44)
                .background(CompetitionTheme.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .contentShape(Capsule())
    }
}

private struct TournamentMap: View {
    let model: TournamentOSAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            EyebrowTitle("Tournament map", detail: "One view of the whole event")
            LoadStateView(state: model.blueprintState, retry: retry) { blueprint in
                VStack(spacing: 0) {
                    JourneyRow(number: "1", title: "Format", detail: "\(blueprint.participantCount) players · \(blueprint.actualContestCount) matches", state: .complete, route: .competition)
                    JourneyConnector()
                    JourneyRow(number: "2", title: "Schedule", detail: "\(blueprint.scheduledContestCount) matches placed", state: .complete, route: .schedule)
                    JourneyConnector()
                    JourneyRow(number: "3", title: "Live event", detail: liveSummary, state: .current, route: .operations)
                    JourneyConnector()
                    JourneyRow(number: "4", title: "Evidence", detail: blueprint.certificationStatus.accessibleTitle, state: blueprint.certificationStatus == .certified ? .complete : .attention, route: .certification)
                }
            }
        }
        .surfaceStyle()
    }

    private var liveSummary: String {
        guard case .loaded(let operations) = model.operationsState else { return "Loading live state" }
        return "\(operations.summary.now) live · \(operations.summary.blocked + operations.summary.late + operations.summary.unreported) need attention"
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private enum JourneyState { case complete, current, attention }

private struct JourneyRow: View {
    let number: String
    let title: String
    let detail: String
    let state: JourneyState
    let route: AppRoute

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(circleColor)
                    if state == .complete {
                        Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.white)
                    } else {
                        Text(number).font(.caption.weight(.bold)).foregroundStyle(state == .current ? .white : .orange)
                    }
                }
                .frame(width: 30, height: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    private var circleColor: Color {
        switch state { case .complete, .current: CompetitionTheme.accent; case .attention: .orange.opacity(0.15) }
    }
}

private struct JourneyConnector: View {
    var body: some View {
        Rectangle().fill(Color.secondary.opacity(0.22)).frame(width: 2, height: 12)
            .padding(.leading, 14).frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct RunningNowPanel: View {
    let model: TournamentOSAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            EyebrowTitle("On court now", detail: "Live play and current resources")
            LoadStateView(state: model.operationsState, retry: retry) { operations in
                let live = operations.items.filter { $0.status == .now }
                if live.isEmpty { InlineEmpty(title: "Nothing live right now", systemImage: "pause.circle") }
                else { ForEach(live) { item in LiveOperationRow(item: item, emphasized: true) } }
            }
        }
        .surfaceStyle()
    }

    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct UpcomingPanel: View {
    let model: TournamentOSAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                EyebrowTitle("Coming up", detail: "The next scheduled contests")
                Spacer()
                NavigationLink("Full schedule", value: AppRoute.schedule).font(.subheadline.weight(.semibold))
            }
            LoadStateView(state: model.scheduleState, retry: retry) { schedule in
                if schedule.items.isEmpty {
                    InlineEmpty(title: "No upcoming contests", systemImage: "calendar.badge.checkmark")
                } else {
                    ForEach(schedule.items.prefix(3)) { item in
                        NavigationLink(value: AppRoute.scheduleItem(id: item.id)) { ScheduleRow(item: item) }.buttonStyle(.plain)
                        if item.id != schedule.items.prefix(3).last?.id { Divider() }
                    }
                }
            }
        }
        .surfaceStyle()
    }

    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct LiveOperationsView: View {
    let model: TournamentOSAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageIntro(kicker: "LIVE", title: "Control room", detail: "See what is happening, what is next, and what needs intervention.")
                LiveOperationsContent(model: model)
                FindingsInline(model: model)
            }
            .pageFrame()
        }
        .background(Color.primary.opacity(0.025))
    }
}

private struct LiveOperationsContent: View {
    let model: TournamentOSAppModel

    var body: some View {
        LoadStateView(state: model.operationsState, retry: retry) { operations in
            VStack(alignment: .leading, spacing: 22) {
                OperationPulse(summary: operations.summary)
                ForEach(LiveOperationStatusDTO.allCases, id: \.self) { status in
                    let matches = operations.items.filter { $0.status == status }
                    if !matches.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Circle().fill(status.tint).frame(width: 8, height: 8)
                                Text(status.sectionTitle).font(.headline)
                                Text(matches.count.formatted()).font(.caption.weight(.bold)).foregroundStyle(.secondary)
                            }
                            ForEach(matches) { LiveOperationRow(item: $0) }
                        }
                    }
                }
                Text("Revision \(operations.revision) · \(operations.timezone) · Updated \(displayTime(operations.asOf))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct OperationPulse: View {
    let summary: LiveControlRoomSummaryDTO

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) { pulseItems }
            VStack(spacing: 0) { pulseItems }
        }
        .background(.background, in: RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous).stroke(Color.primary.opacity(0.08)) }
    }

    @ViewBuilder private var pulseItems: some View {
        ForEach(LiveOperationStatusDTO.allCases, id: \.self) { status in
            HStack(spacing: 7) {
                Circle().fill(status.tint).frame(width: 7, height: 7)
                Text(status.displayName).font(.caption).foregroundStyle(.secondary)
                Text(summary.count(for: status).formatted()).font(.subheadline.weight(.bold)).monospacedDigit()
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(status.displayName): \(summary.count(for: status))")
        }
    }
}

private struct LiveOperationRow: View {
    let item: LiveControlRoomItemDTO
    var emphasized = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 3) {
                Text(displayTime(item.scheduledStart)).font(.subheadline.weight(.bold)).monospacedDigit()
                if let resource = item.resourceID { Text(resource).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(width: 70, alignment: .leading)
            Rectangle().fill(item.status.tint).frame(width: 3).clipShape(Capsule())
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(item.title).font(.headline)
                    Spacer()
                    Text(item.statusText).font(.caption.weight(.semibold)).foregroundStyle(item.status.tint)
                }
                if !item.participantNames.isEmpty {
                    Text(item.participantNames.joined(separator: "  vs  ")).font(.subheadline.weight(.medium)).lineLimit(2)
                }
                Text(item.detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(emphasized ? 0 : 16)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(emphasized ? AnyShapeStyle(.clear) : AnyShapeStyle(.background), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay { if !emphasized { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.primary.opacity(0.07)) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.accessibilityLabel)
    }
}

private struct FindingsInline: View {
    let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.findingsState, retry: retry) { findings in
            if !findings.items.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    EyebrowTitle("Needs review", detail: "Guidance that is not a hard failure")
                    ForEach(findings.items) { finding in
                        NavigationLink(value: AppRoute.finding(id: finding.id)) { FindingRow(finding: finding) }.buttonStyle(.plain)
                    }
                }
                .surfaceStyle()
            }
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct EventView: View {
    let model: TournamentOSAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageIntro(kicker: "OVERVIEW", title: "Tournament workspace", detail: "Move from intent to a verified event without losing the rules that matter.")
                TournamentMap(model: model)
                BlueprintPanel(model: model)
            }.pageFrame()
        }.background(Color.primary.opacity(0.025))
    }
}

private struct BlueprintPanel: View {
    let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.blueprintState, retry: retry) { blueprint in
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    EyebrowTitle("Event blueprint", detail: "Revision \(blueprint.revision)")
                    Spacer(); CertificationBadge(status: blueprint.certificationStatus)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 30) { metrics(blueprint) }
                    VStack(alignment: .leading, spacing: 14) { metrics(blueprint) }
                }
            }.surfaceStyle()
        }
    }
    @ViewBuilder private func metrics(_ blueprint: BlueprintSummaryDTO) -> some View {
        Metric(label: "Players", value: blueprint.participantCount)
        Metric(label: "Matches", value: blueprint.actualContestCount)
        Metric(label: "Scheduled", value: blueprint.scheduledContestCount)
        Metric(label: "Solver", text: blueprint.solverStatus.accessibleTitle)
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct ScheduleView: View {
    let model: TournamentOSAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageIntro(kicker: "PLAN", title: "Schedule", detail: "Courts, times, and possible players—kept in one conflict-checked plan.")
                LoadStateView(state: model.scheduleState, retry: retry) { schedule in
                    SolverStrip(schedule: schedule)
                    VStack(alignment: .leading, spacing: 0) {
                        EyebrowTitle("Order of play", detail: schedule.timezone).padding(.bottom, 10)
                        if schedule.items.isEmpty { InlineEmpty(title: "No scheduled contests", systemImage: "calendar") }
                        else {
                            ForEach(schedule.items) { item in
                                NavigationLink(value: AppRoute.scheduleItem(id: item.id)) { ScheduleRow(item: item) }.buttonStyle(.plain)
                                if item.id != schedule.items.last?.id { Divider() }
                            }
                        }
                    }.surfaceStyle()
                }
            }.pageFrame()
        }.background(Color.primary.opacity(0.025))
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct SolverStrip: View {
    let schedule: ScheduleDTO
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: schedule.solverStatus == .optimal ? "checkmark.seal.fill" : "shield.lefthalf.filled").foregroundStyle(CompetitionTheme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(schedule.solverStatus == .optimal ? "Best schedule proven" : "Valid schedule found").font(.subheadline.weight(.semibold))
                Text("Lower bound \(schedule.lowerBoundMinutes) min" + gapText).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(CompetitionTheme.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    private var gapText: String {
        guard let gap = schedule.optimalityGap else { return "" }
        return " · Gap \(gap.formatted(.percent.precision(.fractionLength(1))))"
    }
}

private struct ScheduleRow: View {
    let item: ScheduleItemDTO
    var body: some View {
        HStack(spacing: 14) {
            Text(displayTime(item.start)).font(.body.weight(.bold)).monospacedDigit().frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(humanized(item.id)).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(item.possibleEntrantIDs.isEmpty ? "Players to be decided" : item.possibleEntrantIDs.joined(separator: "  vs  "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Label(item.resourceID, systemImage: "sportscourt").font(.caption.weight(.medium)).foregroundStyle(.secondary)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 12).frame(minHeight: 52).contentShape(Rectangle())
        .accessibilityElement(children: .ignore).accessibilityLabel(item.accessibilityLabel)
    }
}

private struct ScheduleItemDetailView: View {
    let id: String; let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.scheduleState, retry: retry) { schedule in
            if let item = schedule.items.first(where: { $0.id == id }) {
                Form {
                    Section("Match") { LabeledContent("Name", value: humanized(item.id)); LabeledContent("Court", value: item.resourceID); LabeledContent("Starts", value: item.start); LabeledContent("Ends", value: item.end) }
                    Section("Possible players") { if item.possibleEntrantIDs.isEmpty { Text("Not yet determined") } else { ForEach(item.possibleEntrantIDs, id: \.self) { Text($0) } } }
                }.navigationTitle("Match")
            } else { EmptyMessage(title: "Match unavailable", detail: "It is not present in the current schedule revision.") }
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct ParticipantsView: View {
    let model: TournamentOSAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageIntro(kicker: "PEOPLE", title: "Players & teams", detail: "A clear roster view for check-in, eligibility, and team readiness.")
                LoadStateView(state: model.blueprintState, retry: retry) { blueprint in
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(blueprint.participantCount.formatted()).font(.system(size: 42, weight: .bold, design: .rounded))
                            Text("registered players").foregroundStyle(.secondary)
                        }
                        Divider()
                        Label("Roster rules are compiled and verified on the server", systemImage: "checkmark.shield").font(.subheadline).foregroundStyle(.secondary)
                    }.surfaceStyle()
                }
            }.pageFrame()
        }.background(Color.primary.opacity(0.025))
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct CompetitionView: View {
    let model: TournamentOSAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageIntro(kicker: "DESIGN", title: "Format & rules", detail: "The compiled contest graph, scheduling proof, and revision behind this event.")
                BlueprintPanel(model: model)
            }.pageFrame()
        }.background(Color.primary.opacity(0.025))
    }
}

private struct FindingsView: View {
    let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.findingsState, retry: retry) { findings in
            List {
                if findings.items.isEmpty { Label("No issues found", systemImage: "checkmark.circle").foregroundStyle(.secondary) }
                else { ForEach(findings.items) { finding in NavigationLink(value: AppRoute.finding(id: finding.id)) { FindingRow(finding: finding) } } }
            }
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct FindingRow: View {
    let finding: FindingDTO
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: finding.severity == .error ? "xmark.octagon.fill" : "exclamationmark.triangle.fill").foregroundStyle(finding.severity == .error ? .red : .orange)
            VStack(alignment: .leading, spacing: 4) {
                Text(finding.message).font(.subheadline.weight(.medium))
                Text("\(finding.severity.accessibleTitle) · \(finding.code)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 8).frame(minHeight: 44)
        .accessibilityElement(children: .ignore).accessibilityLabel(finding.accessibilityLabel)
    }
}

private struct FindingDetailView: View {
    let id: String; let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.findingsState, retry: retry) { findings in
            if let finding = findings.items.first(where: { $0.id == id }) {
                Form {
                    Section("Issue") { LabeledContent("Severity", value: finding.severity.accessibleTitle); LabeledContent("Code", value: finding.code); Text(finding.message) }
                    Section("Technical details") { Text(finding.path).font(.body.monospaced()); Text(finding.debugID).font(.body.monospaced()) }
                }.navigationTitle(finding.code)
            } else { EmptyMessage(title: "Issue unavailable", detail: "It is not present in the current revision.") }
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct CertificationView: View {
    let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.certificationState, retry: retry) { certification in
            Form {
                Section("Verification") { HStack { Text(certification.statement); Spacer(); CertificationBadge(status: certification.status) } }
                Section("Proofs") {
                    LabeledContent("Certification hash", value: certification.certificationHash).fontDesign(.monospaced)
                    ForEach(certification.proofIDs.keys.sorted(), id: \.self) { key in LabeledContent(key.capitalized, value: certification.proofIDs[key] ?? "").fontDesign(.monospaced) }
                }
            }
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct ScenariosView: View {
    let model: TournamentOSAppModel
    var body: some View {
        LoadStateView(state: model.blueprintState, retry: retry) { blueprint in
            EmptyMessage(title: "Revision \(blueprint.revision) is live", detail: "Compare a safe what-if revision before replacing the active plan.")
        }
    }
    private func retry() { Task { await model.loadSelectedTournament() } }
}

private struct SettingsView: View {
    var body: some View {
        Form {
            Section("Product") { LabeledContent("App", value: "Krateasy Competitions"); LabeledContent("Engine", value: "TournamentOS") }
            Section("Data authority") { Text("Schedules, competition rules, and certification remain server-authored.").foregroundStyle(.secondary) }
        }
    }
}

private struct MoreView: View {
    let model: TournamentOSAppModel
    var body: some View {
        List {
            Section("Tournament") {
                MoreLink("Overview", image: "map", route: .event)
                MoreLink("Format & rules", image: "point.3.connected.trianglepath.dotted", route: .competition)
                MoreLink("What-if plans", image: "arrow.triangle.branch", route: .scenarios)
            }
            Section("Trust") {
                MoreLink("Issues", image: "exclamationmark.triangle", route: .findings)
                MoreLink("Evidence", image: "checkmark.seal", route: .certification)
            }
            Section { MoreLink("Settings", image: "gearshape", route: .settings) }
        }
    }
}

private struct MoreLink: View {
    let title: String; let image: String; let route: AppRoute
    init(_ title: String, image: String, route: AppRoute) { self.title = title; self.image = image; self.route = route }
    var body: some View { NavigationLink(value: route) { Label(title, systemImage: image).frame(minHeight: 44) } }
}

private struct PageIntro: View {
    let kicker: String; let title: String; let detail: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kicker).font(.caption2.weight(.bold)).tracking(1.4).foregroundStyle(CompetitionTheme.accent)
            Text(title).font(.largeTitle.weight(.bold))
            Text(detail).font(.body).foregroundStyle(.secondary)
        }
    }
}

private struct EyebrowTitle: View {
    let title: String; let detail: String
    init(_ title: String, detail: String) { self.title = title; self.detail = detail }
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct Metric: View {
    let label: String; let text: String
    init(label: String, value: Int) { self.label = label; self.text = value.formatted() }
    init(label: String, text: String) { self.label = label; self.text = text }
    var body: some View {
        VStack(alignment: .leading, spacing: 2) { Text(text).font(.title3.weight(.bold)); Text(label).font(.caption).foregroundStyle(.secondary) }
            .accessibilityElement(children: .ignore).accessibilityLabel("\(label): \(text)")
    }
}

private struct InlineEmpty: View {
    let title: String; let systemImage: String
    var body: some View { Label(title, systemImage: systemImage).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 70, alignment: .leading) }
}

private struct EmptyMessage: View {
    let title: String; let detail: String
    var body: some View { ContentUnavailableView(title, systemImage: "tray", description: Text(detail)).frame(maxWidth: .infinity, minHeight: 220) }
}

private struct LoadStateView<Value: Sendable, LoadedContent: View>: View {
    let state: ContentState<Value>; let retry: () -> Void; @ViewBuilder let loadedContent: (Value) -> LoadedContent
    init(state: ContentState<Value>, retry: @escaping () -> Void, @ViewBuilder content: @escaping (Value) -> LoadedContent) { self.state = state; self.retry = retry; self.loadedContent = content }
    var body: some View {
        switch state {
        case .idle, .loading:
            HStack(spacing: 10) { ProgressView(); Text("Loading…").foregroundStyle(.secondary) }.frame(maxWidth: .infinity, minHeight: 74)
        case .loaded(let value): loadedContent(value)
        case .failed(let failure):
            ContentUnavailableView { Label("Couldn’t load data", systemImage: "wifi.exclamationmark") } description: { Text(failure.message) } actions: { Button("Try Again", action: retry).buttonStyle(.borderedProminent).frame(minHeight: 44) }
        }
    }
}

private struct CertificationBadge: View {
    let status: CertificationStatusDTO
    var body: some View {
        Label(status.accessibleTitle, systemImage: status == .certified ? "checkmark.seal.fill" : "xmark.seal.fill")
            .font(.caption.weight(.semibold))
            .foregroundStyle(status == .certified ? CompetitionTheme.accent : Color.red)
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background((status == .certified ? CompetitionTheme.accent : Color.red).opacity(0.11), in: Capsule())
            .accessibilityLabel("Certification: \(status.accessibleTitle)")
    }
}

private extension View {
    func surfaceStyle() -> some View {
        padding(18)
            .background(.background, in: RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: CompetitionTheme.corner, style: .continuous).stroke(Color.primary.opacity(0.07)) }
    }
    func pageFrame() -> some View {
        padding(.horizontal, 20).padding(.vertical, 18)
            .frame(maxWidth: CompetitionTheme.contentWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
    }
}

private func displayTime(_ value: String?) -> String {
    guard let value, let marker = value.firstIndex(of: "T") else { return "—" }
    let start = value.index(after: marker)
    return String(value[start...].prefix(5))
}

private func humanized(_ value: String) -> String {
    value.replacingOccurrences(of: ".", with: " · ").replacingOccurrences(of: "-", with: " ").capitalized
}

private extension CertificationStatusDTO {
    var accessibleTitle: String { self == .certified ? "Certified" : "Rejected" }
}

private extension SolverStatusDTO {
    var accessibleTitle: String {
        switch self { case .optimal: "Optimal"; case .feasible: "Feasible"; case .infeasible: "Infeasible"; case .unknown: "Unknown" }
    }
}

private extension FindingSeverityDTO {
    var accessibleTitle: String { self == .error ? "Error" : "Warning" }
}

private extension LiveControlRoomSummaryDTO {
    func count(for status: LiveOperationStatusDTO) -> Int {
        switch status { case .now: now; case .next: next; case .late: late; case .blocked: blocked; case .unreported: unreported }
    }
}

private extension LiveOperationStatusDTO {
    var sectionTitle: String {
        switch self { case .now: "On court now"; case .next: "Up next"; case .late: "Running late"; case .blocked: "Blocked"; case .unreported: "Missing results" }
    }
    var tint: Color {
        switch self { case .now: CompetitionTheme.accent; case .next: .blue; case .late: .orange; case .blocked: .red; case .unreported: Color.secondary }
    }
}

private extension CompetitionWorkspaceKindDTO {
    var systemImage: String {
        switch self {
        case .personal: "person.crop.circle"
        case .club: "building.2"
        case .promoter: "megaphone"
        case .league: "list.number"
        case .federation: "network"
        case .whiteLabel: "paintpalette"
        }
    }
}

private struct CompetitionStartDefaults {
    let sport: String
    let participantCount: Int
    let formatName: String
    let minimumRestMinutes: Int
    let resourceCount: Int
    let priority: String
}

private extension CompetitionStartPreset {
    var title: String {
        switch self {
        case .quickPlay: "Quick play"
        case .clubEvent: "Club event"
        case .leagueSeason: "League or season"
        case .complexEvent: "Complex event"
        }
    }

    var detail: String {
        switch self {
        case .quickPlay: "Friends, one session, minimal setup"
        case .clubEvent: "Registration, divisions and courts"
        case .leagueSeason: "Recurring rounds and standings"
        case .complexEvent: "Multiple stages, venues and policies"
        }
    }

    var systemImage: String {
        switch self {
        case .quickPlay: "bolt.fill"
        case .clubEvent: "trophy.fill"
        case .leagueSeason: "calendar.badge.clock"
        case .complexEvent: "point.3.connected.trianglepath.dotted"
        }
    }

    var defaults: CompetitionStartDefaults {
        switch self {
        case .quickPlay:
            CompetitionStartDefaults(
                sport: "Padel", participantCount: 8, formatName: "Round robin",
                minimumRestMinutes: 10, resourceCount: 2, priority: "Finish on time"
            )
        case .clubEvent:
            CompetitionStartDefaults(
                sport: "Padel", participantCount: 16, formatName: "Pools → knockout",
                minimumRestMinutes: 30, resourceCount: 4, priority: "Protect player rest"
            )
        case .leagueSeason:
            CompetitionStartDefaults(
                sport: "Padel", participantCount: 24, formatName: "League table",
                minimumRestMinutes: 30, resourceCount: 4, priority: "Minimise court changes"
            )
        case .complexEvent:
            CompetitionStartDefaults(
                sport: "Padel", participantCount: 64, formatName: "Pools → knockout",
                minimumRestMinutes: 30, resourceCount: 8, priority: "Protect player rest"
            )
        }
    }
}
