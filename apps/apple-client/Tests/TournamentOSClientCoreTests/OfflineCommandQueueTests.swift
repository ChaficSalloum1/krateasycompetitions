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
