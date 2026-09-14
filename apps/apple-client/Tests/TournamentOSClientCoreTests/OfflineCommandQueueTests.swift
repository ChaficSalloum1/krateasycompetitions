import Foundation
import Testing
@testable import TournamentOSClientCore

private actor ScriptedClock: OfflineCommandClock {
    private var values: [Date]

    init(_ values: [Date]) {
        self.values = values
    }

    func now() -> Date {
        precondition(!values.isEmpty, "Scripted clock exhausted")
        return values.removeFirst()
    }
}

private actor ScriptedIDs: OfflineCommandIDGenerator {
    private var values: [UUID]

    init(_ values: [UUID]) {
        self.values = values
    }

    func next() -> UUID {
        precondition(!values.isEmpty, "Scripted ID generator exhausted")
        return values.removeFirst()
    }
}

private actor ScriptedOfflineTransport: OfflineCommandTransport {
    enum Outcome: Sendable {
        case unavailable
        case rejected(actualVersion: Int, reason: String)
        case accepted(version: Int)
    }

    private var outcomes: [Outcome]
    private var submittedKeys: [String] = []

    init(_ outcomes: [Outcome]) { self.outcomes = outcomes }

    func submit(_ envelope: OfflineCommandEnvelope) throws -> OfflineCommandReceipt {
        submittedKeys.append(envelope.idempotencyKey)
        switch outcomes.removeFirst() {
        case .unavailable: throw OfflineCommandTransportError.unavailable
        case .rejected(let version, let reason):
            throw OfflineCommandTransportError.rejected(actualAggregateVersion: version, reason: reason)
        case .accepted(let version): return OfflineCommandReceipt(aggregateVersion: version)
        }
    }

    func keys() -> [String] { submittedKeys }
}

private let t0 = Date(timeIntervalSince1970: 1_788_600_000)
private let t1 = t0.addingTimeInterval(10)
private let t2 = t0.addingTimeInterval(20)
private let t3 = t0.addingTimeInterval(30)
private let t4 = t0.addingTimeInterval(40)
private let t5 = t0.addingTimeInterval(50)
private let id1 = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
private let id2 = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!

private func draft(
    key: String = "command-001",
    expectedVersion: Int = 7,
    payload: Data = Data(#"{"court":1}"#.utf8)
) -> OfflineCommandDraft {
    OfflineCommandDraft(
        idempotencyKey: key,
        aggregateID: "tournament-42",
        expectedAggregateVersion: expectedVersion,
        commandName: "AssignCourt",
        payload: payload
    )
}

@Test("enqueue is deterministic and replay cannot silently reuse an idempotency key")
func enqueueIsIdempotentWithoutOverwrite() async throws {
    let persistence = InMemoryOfflineCommandQueuePersistence()
    let queue = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([t0]),
        idGenerator: ScriptedIDs([id1])
    )

    let first = try await queue.enqueue(draft())
    let replay = try await queue.enqueue(draft())
    #expect(first == replay)
    #expect(first.id == id1)
    #expect(first.state == .pending)
    #expect(first.attemptCount == 0)
    #expect(first.createdAt == t0)
    #expect(first.expectedAggregateVersion == 7)

    await #expect(throws: OfflineCommandQueueError.idempotencyKeyReuse("command-001")) {
        try await queue.enqueue(draft(payload: Data(#"{"court":2}"#.utf8)))
    }
    #expect(try await queue.all().count == 1)
    #expect(await persistence.snapshot().count == 1)

    let encoded = try JSONEncoder().encode(first)
    #expect(try JSONDecoder().decode(OfflineCommandEnvelope.self, from: encoded) == first)
}

@Test("the oldest eligible command is atomically claimed into sending state")
func claimTransitionsToSending() async throws {
    let persistence = InMemoryOfflineCommandQueuePersistence()
    let queue = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([t0, t1]),
        idGenerator: ScriptedIDs([id1])
    )
    _ = try await queue.enqueue(draft())

    let claimed = try await queue.claimNext(workerID: "sync-worker")
    #expect(claimed?.state == .sending)
    #expect(claimed?.sendingWorkerID == "sync-worker")
    #expect(claimed?.attemptCount == 1)
    #expect(claimed?.updatedAt == t1)
    #expect(try await queue.claimNext(workerID: "other-worker") == nil)
    #expect(await persistence.snapshot().first == claimed)
}

@Test("transport failure retries only after its explicit deterministic delay")
func retryIsExplicitAndDeterministic() async throws {
    let queue = OfflineCommandQueue(
        persistence: InMemoryOfflineCommandQueuePersistence(),
        clock: ScriptedClock([t0, t1, t2, t3, t5]),
        idGenerator: ScriptedIDs([id1])
    )
    _ = try await queue.enqueue(draft())
    _ = try await queue.claimNext(workerID: "worker-a")

    await #expect(throws: OfflineCommandQueueError.workerMismatch(expected: "worker-a", actual: "worker-b")) {
        try await queue.retry(
            idempotencyKey: "command-001",
            workerID: "worker-b",
            error: "offline",
            delay: 30
        )
    }
    let pending = try await queue.retry(
        idempotencyKey: "command-001",
        workerID: "worker-a",
        error: "offline",
        delay: 30
    )
    #expect(pending.state == .pending)
    #expect(pending.lastError == "offline")
    #expect(pending.nextAttemptAt == t5)
    #expect(pending.sendingWorkerID == nil)
    #expect(try await queue.claimNext(workerID: "worker-b") == nil)
    let retried = try await queue.claimNext(workerID: "worker-b")
    #expect(retried?.state == .sending)
    #expect(retried?.attemptCount == 2)
}

@Test("version conflict is durable and requires explicit audited reconciliation")
func conflictRequiresExplicitReconciliation() async throws {
    let persistence = InMemoryOfflineCommandQueuePersistence()
    let queue = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([t0, t1, t2, t3, t4, t5]),
        idGenerator: ScriptedIDs([id1])
    )
    _ = try await queue.enqueue(draft(expectedVersion: 7))
    _ = try await queue.claimNext(workerID: "worker-a")
    let conflicted = try await queue.markConflicted(
        idempotencyKey: "command-001",
        workerID: "worker-a",
        actualAggregateVersion: 9,
        reason: "Server advanced while device was offline"
    )
    #expect(conflicted.state == .conflicted)
    #expect(conflicted.sendingWorkerID == nil)
    #expect(conflicted.conflict == OfflineCommandConflict(
        actualAggregateVersion: 9,
        reason: "Server advanced while device was offline",
        detectedAt: t2
    ))
    #expect(try await queue.claimNext(workerID: "worker-b") == nil)

    await #expect(throws: OfflineCommandQueueError.reconciliationKeyReuse("command-001")) {
        try await queue.reconcileConflict(
            idempotencyKey: "command-001",
            replacementIdempotencyKey: "command-001",
            expectedAggregateVersion: 9
        )
    }
    let reconciled = try await queue.reconcileConflict(
        idempotencyKey: "command-001",
        replacementIdempotencyKey: "command-001-reconciled",
        expectedAggregateVersion: 9
    )
    #expect(reconciled.state == .pending)
    #expect(reconciled.idempotencyKey == "command-001-reconciled")
    #expect(reconciled.expectedAggregateVersion == 9)
    #expect(reconciled.conflict == nil)
    #expect(reconciled.attemptCount == 1)
    #expect(reconciled.reconciliationHistory == [OfflineCommandReconciliation(
        previousIdempotencyKey: "command-001",
        replacementIdempotencyKey: "command-001-reconciled",
        previousExpectedAggregateVersion: 7,
        replacementExpectedAggregateVersion: 9,
        actualAggregateVersion: 9,
        conflictReason: "Server advanced while device was offline",
        reconciledAt: t3
    )])
    #expect(await persistence.snapshot().first == reconciled)

    _ = try await queue.claimNext(workerID: "worker-b")
    _ = try await queue.markConflicted(
        idempotencyKey: "command-001-reconciled",
        workerID: "worker-b",
        actualAggregateVersion: 10,
        reason: "A second server advance"
    )
    await #expect(throws: OfflineCommandQueueError.reconciliationKeyReuse("command-001")) {
        try await queue.reconcileConflict(
            idempotencyKey: "command-001-reconciled",
            replacementIdempotencyKey: "command-001",
            expectedAggregateVersion: 10
        )
    }
}

@Test("acknowledgement is owner-bound, durable, and cannot be delivered twice after restart")
func acknowledgementIsDurableAndTerminal() async throws {
    let persistence = InMemoryOfflineCommandQueuePersistence()
    let queue = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([t0, t1, t2]),
        idGenerator: ScriptedIDs([id1])
    )
    _ = try await queue.enqueue(draft())
    _ = try await queue.claimNext(workerID: "worker-a")
    await #expect(throws: OfflineCommandQueueError.workerMismatch(expected: "worker-a", actual: "worker-b")) {
        try await queue.acknowledge(
            idempotencyKey: "command-001",
            workerID: "worker-b",
            aggregateVersion: 8
        )
    }
    let acknowledged = try await queue.acknowledge(
        idempotencyKey: "command-001",
        workerID: "worker-a",
        aggregateVersion: 8
    )
    #expect(acknowledged.state == .acknowledged)
    #expect(acknowledged.sendingWorkerID == nil)
    #expect(acknowledged.acknowledgement == OfflineCommandAcknowledgement(
        aggregateVersion: 8,
        acknowledgedAt: t2
    ))

    let reopened = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([]),
        idGenerator: ScriptedIDs([])
    )
    #expect(try await reopened.all() == [acknowledged])
    #expect(try await reopened.enqueue(draft()) == acknowledged)
    #expect(try await reopened.claimNext(workerID: "worker-b") == nil)
    await #expect(throws: OfflineCommandQueueError.invalidTransition(
        idempotencyKey: "command-001",
        from: .acknowledged,
        to: .pending
    )) {
        try await reopened.retry(
            idempotencyKey: "command-001",
            workerID: "worker-a",
            error: "must not retry",
            delay: 0
        )
    }
}

@Test("a scoped file journal recovers an interrupted send and never re-emits its acknowledgement")
func fileJournalRecoversInterruptedSendExactlyOnce() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("krateasy-offline-journal-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent("commands.json")
    let scope = OfflineCommandQueueScope(organizationID: "org.st-albans", competitionID: "tournament-42")
    let persistence = try FileOfflineCommandQueuePersistence(fileURL: file, scope: scope)
    let firstProcess = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([t0, t1]),
        idGenerator: ScriptedIDs([id1])
    )
    _ = try await firstProcess.enqueue(draft())
    let interrupted = try await firstProcess.claimNext(workerID: "mac-before-crash")
    #expect(interrupted?.state == .sending)

    let recoveredProcess = OfflineCommandQueue(
        persistence: try FileOfflineCommandQueuePersistence(fileURL: file, scope: scope),
        clock: ScriptedClock([t2, t3, t4]),
        idGenerator: ScriptedIDs([])
    )
    let recovered = try await recoveredProcess.all().first
    #expect(recovered?.state == .pending)
    #expect(recovered?.attemptCount == 1)
    #expect(recovered?.sendingWorkerID == nil)
    #expect(recovered?.lastError == "Recovered an interrupted send before acknowledgement.")
    let reclaimed = try await recoveredProcess.claimNext(workerID: "mac-after-restart")
    #expect(reclaimed?.attemptCount == 2)
    let acknowledged = try await recoveredProcess.acknowledge(
        idempotencyKey: "command-001",
        workerID: "mac-after-restart",
        aggregateVersion: 8
    )

    let finalProcess = OfflineCommandQueue(
        persistence: try FileOfflineCommandQueuePersistence(fileURL: file, scope: scope),
        clock: ScriptedClock([]),
        idGenerator: ScriptedIDs([])
    )
    #expect(try await finalProcess.all() == [acknowledged])
    #expect(try await finalProcess.claimNext(workerID: "must-not-redeliver") == nil)
    let permissions = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
    #expect(permissions?.intValue == 0o600)
}

@Test("the durable journal fails closed on another competition or tampered command bytes")
func fileJournalIsScopeBoundAndTamperEvident() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("krateasy-offline-integrity-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent("commands.json")
    let scope = OfflineCommandQueueScope(organizationID: "org.st-albans", competitionID: "tournament-42")
    let queue = OfflineCommandQueue(
        persistence: try FileOfflineCommandQueuePersistence(fileURL: file, scope: scope),
        clock: ScriptedClock([t0]),
        idGenerator: ScriptedIDs([id1])
    )
    _ = try await queue.enqueue(draft())

    let otherScope = try FileOfflineCommandQueuePersistence(
        fileURL: file,
        scope: OfflineCommandQueueScope(organizationID: "org.other", competitionID: "tournament-42")
    )
    await #expect(throws: OfflineCommandPersistenceError.scopeMismatch) {
        try await otherScope.load()
    }

    var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    var envelopes = try #require(object["envelopes"] as? [[String: Any]])
    envelopes[0]["commandName"] = "ForgedCommand"
    object["envelopes"] = envelopes
    try JSONSerialization.data(withJSONObject: object).write(to: file, options: [.atomic])
    let reopened = try FileOfflineCommandQueuePersistence(fileURL: file, scope: scope)
    await #expect(throws: OfflineCommandPersistenceError.integrityCheckFailed) {
        try await reopened.load()
    }

    let isolatedFile = directory.appendingPathComponent("isolated.json")
    let isolated = try FileOfflineCommandQueuePersistence(fileURL: isolatedFile, scope: scope)
    await #expect(throws: OfflineCommandPersistenceError.scopeMismatch) {
        try await isolated.save([OfflineCommandEnvelope(
            id: id2,
            draft: OfflineCommandDraft(
                idempotencyKey: "cross-competition",
                aggregateID: "another-tournament",
                expectedAggregateVersion: 0,
                commandName: "CheckIn",
                payload: Data()
            ),
            createdAt: t0
        )])
    }
}

@Test("the synchronizer retries unavailable transport and preserves an authoritative conflict for review")
func synchronizerNeverOverwritesServerTruth() async throws {
    let queue = OfflineCommandQueue(
        persistence: InMemoryOfflineCommandQueuePersistence(),
        clock: ScriptedClock([t0, t1, t2, t3, t4, t5]),
        idGenerator: ScriptedIDs([id1])
    )
    let liveDraft = try OfflineCommandDraft.live(
        idempotencyKey: "mac.command.1",
        competitionID: "tournament-42",
        publishedRevision: 1,
        expectedLiveVersion: 7,
        action: .call(contestID: "advanced.pools.P1.R1.M1")
    )
    _ = try await queue.enqueue(liveDraft)
    let transport = ScriptedOfflineTransport([
        .unavailable,
        .rejected(actualVersion: 9, reason: "live_version_conflict"),
    ])
    let synchronizer = OfflineCommandSynchronizer(
        queue: queue,
        transport: transport,
        workerID: "mac.sync",
        retryDelay: 0
    )

    guard case .retryScheduled(let pending) = try await synchronizer.syncNext() else {
        Issue.record("Expected retry scheduling")
        return
    }
    #expect(pending.state == .pending)
    #expect(pending.attemptCount == 1)
    guard case .conflicted(let conflicted) = try await synchronizer.syncNext() else {
        Issue.record("Expected an explicit conflict")
        return
    }
    #expect(conflicted.state == .conflicted)
    #expect(conflicted.attemptCount == 2)
    #expect(conflicted.conflict?.actualAggregateVersion == 9)
    #expect(conflicted.conflict?.reason == "live_version_conflict")
    #expect(await transport.keys() == ["mac.command.1", "mac.command.1"])
    #expect(try await synchronizer.syncNext() == .idle)
    let reconciled = try await queue.reconcileConflict(
        idempotencyKey: "mac.command.1",
        replacementIdempotencyKey: "mac.command.1.reconciled",
        expectedAggregateVersion: 9
    )
    let body = try #require(JSONSerialization.jsonObject(with: reconciled.payload) as? [String: Any])
    let command = try #require(body["command"] as? [String: Any])
    #expect(command["commandId"] as? String == "mac.command.1.reconciled")
    #expect(command["expectedVersion"] as? Int == 9)
}

@Test("all essential offline live commands encode the strict connected boundary without authority fields")
func essentialOfflineCommandsUseExactServerSchema() throws {
    let scores = [OfflineLiveScore(entrantID: "pair.1", value: 6), OfflineLiveScore(entrantID: "pair.2", value: 4)]
    let actions: [OfflineLiveCommandAction] = [
        .checkIn(entrantID: "pair.1"),
        .call(contestID: "match.1"),
        .start(contestID: "match.1", courtID: "court.1", startedAt: "2026-09-20T10:00:00.000Z"),
        .score(contestID: "match.1", scores: scores),
        .finish(contestID: "match.1", endedAt: "2026-09-20T10:30:00.000Z"),
        .walkover(contestID: "match.1", winnerEntrantID: "pair.1", absentEntrantID: "pair.2", reason: "No show"),
        .correction(supersedesEventID: "event.7", reason: "Score transposed", contestID: "match.1",
                    scores: Array(scores.reversed()), replacementReason: "Signed court sheet"),
    ]

    for (index, action) in actions.enumerated() {
        let draft = try OfflineCommandDraft.live(
            idempotencyKey: "offline.\(index)", competitionID: "tournament-42",
            publishedRevision: 1, expectedLiveVersion: 7 + index, action: action
        )
        let object = try #require(JSONSerialization.jsonObject(with: draft.payload) as? [String: Any])
        let command = try #require(object["command"] as? [String: Any])
        #expect(command["commandId"] as? String == draft.idempotencyKey)
        #expect(command["expectedVersion"] as? Int == draft.expectedAggregateVersion)
        #expect(command["kind"] as? String == draft.commandName)
        #expect(command["actorId"] == nil)
        #expect(command["occurredAt"] == nil)
        #expect(object["guardInput"] == nil)
    }
}

@Test("a conflicted earlier command blocks later commands from being reordered")
func conflictPreservesCausalCommandOrder() async throws {
    let queue = OfflineCommandQueue(
        persistence: InMemoryOfflineCommandQueuePersistence(),
        clock: ScriptedClock([t0, t1, t2, t3, t4]),
        idGenerator: ScriptedIDs([id1, id2])
    )
    _ = try await queue.enqueue(draft(key: "command-001", expectedVersion: 7))
    _ = try await queue.enqueue(draft(key: "command-002", expectedVersion: 8))
    _ = try await queue.claimNext(workerID: "mac.sync")
    _ = try await queue.markConflicted(
        idempotencyKey: "command-001", workerID: "mac.sync",
        actualAggregateVersion: 9, reason: "Another device advanced the server"
    )

    #expect(try await queue.claimNext(workerID: "mac.sync") == nil)
    #expect(try await queue.all().last?.state == .pending)
    #expect(try await queue.all().last?.attemptCount == 0)
}

@Test("oversized offline command payloads fail before durable persistence")
func oversizedPayloadFailsClosed() async throws {
    let persistence = InMemoryOfflineCommandQueuePersistence()
    let queue = OfflineCommandQueue(
        persistence: persistence,
        clock: ScriptedClock([]),
        idGenerator: ScriptedIDs([])
    )
    await #expect(throws: OfflineCommandQueueError.invalidDraft("payload")) {
        try await queue.enqueue(draft(payload: Data(repeating: 0x41, count: 64_001)))
    }
    #expect(await persistence.snapshot().isEmpty)
}
