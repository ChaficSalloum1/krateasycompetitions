import Foundation

public protocol OfflineCommandClock: Sendable {
    func now() async -> Date
}

public protocol OfflineCommandIDGenerator: Sendable {
    func next() async -> UUID
}

public struct SystemOfflineCommandClock: OfflineCommandClock {
    public init() {}
    public func now() -> Date { Date() }
}

public struct SystemOfflineCommandIDGenerator: OfflineCommandIDGenerator {
    public init() {}
    public func next() -> UUID { UUID() }
}

public enum OfflineCommandState: String, Codable, Sendable, Equatable {
    case pending
    case sending
    case conflicted
    case acknowledged
}

public struct OfflineCommandDraft: Codable, Sendable, Equatable {
    public let idempotencyKey: String
    public let aggregateID: String
    public let expectedAggregateVersion: Int
    public let commandName: String
    public let payload: Data

    public init(
        idempotencyKey: String,
        aggregateID: String,
        expectedAggregateVersion: Int,
        commandName: String,
        payload: Data
    ) {
        self.idempotencyKey = idempotencyKey
        self.aggregateID = aggregateID
        self.expectedAggregateVersion = expectedAggregateVersion
        self.commandName = commandName
        self.payload = payload
    }
}

public struct OfflineCommandConflict: Codable, Sendable, Equatable {
    public let actualAggregateVersion: Int
    public let reason: String
    public let detectedAt: Date
}

public struct OfflineCommandAcknowledgement: Codable, Sendable, Equatable {
    public let aggregateVersion: Int
    public let acknowledgedAt: Date
}

public struct OfflineCommandReconciliation: Codable, Sendable, Equatable {
    public let previousIdempotencyKey: String
    public let replacementIdempotencyKey: String
    public let previousExpectedAggregateVersion: Int
    public let replacementExpectedAggregateVersion: Int
    public let actualAggregateVersion: Int
    public let conflictReason: String
    public let reconciledAt: Date
}

public struct OfflineCommandEnvelope: Codable, Sendable, Equatable, Identifiable {
    public let id: UUID
    public var idempotencyKey: String
    public let aggregateID: String
    public var expectedAggregateVersion: Int
    public let commandName: String
    public let payload: Data
    public var state: OfflineCommandState
    public var attemptCount: Int
    public let createdAt: Date
    public var updatedAt: Date
    public var nextAttemptAt: Date?
    public var sendingWorkerID: String?
    public var conflict: OfflineCommandConflict?
    public var acknowledgement: OfflineCommandAcknowledgement?
    public var lastError: String?
    public var reconciliationHistory: [OfflineCommandReconciliation]

    public init(
        id: UUID,
        draft: OfflineCommandDraft,
        createdAt: Date
    ) {
        self.id = id
        idempotencyKey = draft.idempotencyKey
        aggregateID = draft.aggregateID
        expectedAggregateVersion = draft.expectedAggregateVersion
        commandName = draft.commandName
        payload = draft.payload
        state = .pending
        attemptCount = 0
        self.createdAt = createdAt
        updatedAt = createdAt
        nextAttemptAt = nil
        sendingWorkerID = nil
        conflict = nil
        acknowledgement = nil
        lastError = nil
        reconciliationHistory = []
    }
}

public protocol OfflineCommandQueuePersistence: Sendable {
    func load() async throws -> [OfflineCommandEnvelope]
    func save(_ envelopes: [OfflineCommandEnvelope]) async throws
}

public actor InMemoryOfflineCommandQueuePersistence: OfflineCommandQueuePersistence {
    private var envelopes: [OfflineCommandEnvelope]

    public init(initial: [OfflineCommandEnvelope] = []) {
        envelopes = initial
    }

    public func load() -> [OfflineCommandEnvelope] {
        envelopes
    }

    public func save(_ envelopes: [OfflineCommandEnvelope]) {
        self.envelopes = envelopes
    }

    public func snapshot() -> [OfflineCommandEnvelope] {
        envelopes
    }
}

public enum OfflineCommandQueueError: Error, Sendable, Equatable {
    case invalidDraft(String)
    case idempotencyKeyReuse(String)
    case commandNotFound(String)
    case invalidTransition(idempotencyKey: String, from: OfflineCommandState, to: OfflineCommandState)
    case workerMismatch(expected: String, actual: String)
    case reconciliationKeyReuse(String)
    case invalidReconciliationVersion(expected: Int, actual: Int)
}

public actor OfflineCommandQueue {
    private let persistence: any OfflineCommandQueuePersistence
    private let clock: any OfflineCommandClock
    private let idGenerator: any OfflineCommandIDGenerator
    private var envelopes: [OfflineCommandEnvelope] = []
    private var isLoaded = false

    public init(
        persistence: any OfflineCommandQueuePersistence,
        clock: any OfflineCommandClock = SystemOfflineCommandClock(),
        idGenerator: any OfflineCommandIDGenerator = SystemOfflineCommandIDGenerator()
    ) {
        self.persistence = persistence
        self.clock = clock
        self.idGenerator = idGenerator
    }

    private func loadIfNeeded() async throws {
        guard !isLoaded else { return }
        envelopes = try await persistence.load()
        sortEnvelopes(&envelopes)
        isLoaded = true
    }

    private func sortEnvelopes(_ values: inout [OfflineCommandEnvelope]) {
        values.sort {
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    private func validate(_ draft: OfflineCommandDraft) throws {
        guard !draft.idempotencyKey.isEmpty else { throw OfflineCommandQueueError.invalidDraft("idempotencyKey") }
        guard !draft.aggregateID.isEmpty else { throw OfflineCommandQueueError.invalidDraft("aggregateID") }
        guard draft.expectedAggregateVersion >= 0 else { throw OfflineCommandQueueError.invalidDraft("expectedAggregateVersion") }
        guard !draft.commandName.isEmpty else { throw OfflineCommandQueueError.invalidDraft("commandName") }
    }

    private func hasSameCommand(_ envelope: OfflineCommandEnvelope, as draft: OfflineCommandDraft) -> Bool {
        envelope.aggregateID == draft.aggregateID
            && envelope.expectedAggregateVersion == draft.expectedAggregateVersion
            && envelope.commandName == draft.commandName
            && envelope.payload == draft.payload
    }

    private func hasEverUsedIdempotencyKey(_ key: String, excludingID: UUID? = nil) -> Bool {
        envelopes.contains { envelope in
            let currentKeyIsUnavailable = envelope.id != excludingID && envelope.idempotencyKey == key
            let historicalKeyIsUnavailable = envelope.reconciliationHistory.contains {
                $0.previousIdempotencyKey == key || $0.replacementIdempotencyKey == key
            }
            return currentKeyIsUnavailable || historicalKeyIsUnavailable
        }
    }

    private func commit(_ updated: [OfflineCommandEnvelope]) async throws {
        try await persistence.save(updated)
        envelopes = updated
    }

    public func enqueue(_ draft: OfflineCommandDraft) async throws -> OfflineCommandEnvelope {
        try validate(draft)
        try await loadIfNeeded()
        if let existing = envelopes.first(where: { $0.idempotencyKey == draft.idempotencyKey }) {
            guard hasSameCommand(existing, as: draft) else {
                throw OfflineCommandQueueError.idempotencyKeyReuse(draft.idempotencyKey)
            }
            return existing
        }
        if hasEverUsedIdempotencyKey(draft.idempotencyKey) {
            throw OfflineCommandQueueError.idempotencyKeyReuse(draft.idempotencyKey)
        }
        let createdAt = await clock.now()
        let id = await idGenerator.next()
        let envelope = OfflineCommandEnvelope(id: id, draft: draft, createdAt: createdAt)
        var updated = envelopes
        updated.append(envelope)
        sortEnvelopes(&updated)
        try await commit(updated)
        return envelope
    }

    public func all() async throws -> [OfflineCommandEnvelope] {
        try await loadIfNeeded()
        return envelopes
    }

    public func claimNext(workerID: String) async throws -> OfflineCommandEnvelope? {
        guard !workerID.isEmpty else { throw OfflineCommandQueueError.invalidDraft("workerID") }
        try await loadIfNeeded()
        guard envelopes.contains(where: { $0.state == .pending }) else { return nil }
        let claimedAt = await clock.now()
        guard let index = envelopes.firstIndex(where: {
            $0.state == .pending && ($0.nextAttemptAt == nil || $0.nextAttemptAt! <= claimedAt)
        }) else { return nil }
        var updated = envelopes
        updated[index].state = .sending
        updated[index].sendingWorkerID = workerID
        updated[index].attemptCount += 1
        updated[index].updatedAt = claimedAt
        updated[index].nextAttemptAt = nil
        try await commit(updated)
        return updated[index]
    }

    public func retry(
        idempotencyKey: String,
        workerID: String,
        error: String,
        delay: TimeInterval
    ) async throws -> OfflineCommandEnvelope {
        try await loadIfNeeded()
        guard let index = envelopes.firstIndex(where: { $0.idempotencyKey == idempotencyKey }) else {
            throw OfflineCommandQueueError.commandNotFound(idempotencyKey)
        }
        let current = envelopes[index]
        guard current.state == .sending else {
            throw OfflineCommandQueueError.invalidTransition(idempotencyKey: idempotencyKey, from: current.state, to: .pending)
        }
        guard current.sendingWorkerID == workerID else {
            throw OfflineCommandQueueError.workerMismatch(expected: current.sendingWorkerID ?? "", actual: workerID)
        }
        guard !error.isEmpty, delay.isFinite, delay >= 0 else {
            throw OfflineCommandQueueError.invalidDraft("retry")
        }
        let failedAt = await clock.now()
        var updated = envelopes
        updated[index].state = .pending
        updated[index].sendingWorkerID = nil
        updated[index].lastError = error
        updated[index].updatedAt = failedAt
        updated[index].nextAttemptAt = failedAt.addingTimeInterval(delay)
        try await commit(updated)
        return updated[index]
    }

    public func markConflicted(
        idempotencyKey: String,
        workerID: String,
        actualAggregateVersion: Int,
        reason: String
    ) async throws -> OfflineCommandEnvelope {
        try await loadIfNeeded()
        guard let index = envelopes.firstIndex(where: { $0.idempotencyKey == idempotencyKey }) else {
            throw OfflineCommandQueueError.commandNotFound(idempotencyKey)
        }
        let current = envelopes[index]
        guard current.state == .sending else {
            throw OfflineCommandQueueError.invalidTransition(idempotencyKey: idempotencyKey, from: current.state, to: .conflicted)
        }
        guard current.sendingWorkerID == workerID else {
            throw OfflineCommandQueueError.workerMismatch(expected: current.sendingWorkerID ?? "", actual: workerID)
        }
        guard actualAggregateVersion >= 0, !reason.isEmpty else {
            throw OfflineCommandQueueError.invalidDraft("conflict")
        }
        let detectedAt = await clock.now()
        var updated = envelopes
        updated[index].state = .conflicted
        updated[index].sendingWorkerID = nil
        updated[index].nextAttemptAt = nil
        updated[index].updatedAt = detectedAt
        updated[index].conflict = OfflineCommandConflict(
            actualAggregateVersion: actualAggregateVersion,
            reason: reason,
            detectedAt: detectedAt
        )
        try await commit(updated)
        return updated[index]
    }

    public func reconcileConflict(
        idempotencyKey: String,
        replacementIdempotencyKey: String,
        expectedAggregateVersion: Int
    ) async throws -> OfflineCommandEnvelope {
        try await loadIfNeeded()
        guard let index = envelopes.firstIndex(where: { $0.idempotencyKey == idempotencyKey }) else {
            throw OfflineCommandQueueError.commandNotFound(idempotencyKey)
        }
        let current = envelopes[index]
        guard current.state == .conflicted, let conflict = current.conflict else {
            throw OfflineCommandQueueError.invalidTransition(idempotencyKey: idempotencyKey, from: current.state, to: .pending)
        }
        guard !replacementIdempotencyKey.isEmpty,
              replacementIdempotencyKey != idempotencyKey,
              !hasEverUsedIdempotencyKey(replacementIdempotencyKey, excludingID: current.id) else {
            throw OfflineCommandQueueError.reconciliationKeyReuse(replacementIdempotencyKey)
        }
        guard expectedAggregateVersion == conflict.actualAggregateVersion else {
            throw OfflineCommandQueueError.invalidReconciliationVersion(
                expected: conflict.actualAggregateVersion,
                actual: expectedAggregateVersion
            )
        }
        let reconciledAt = await clock.now()
        let reconciliation = OfflineCommandReconciliation(
            previousIdempotencyKey: current.idempotencyKey,
            replacementIdempotencyKey: replacementIdempotencyKey,
            previousExpectedAggregateVersion: current.expectedAggregateVersion,
            replacementExpectedAggregateVersion: expectedAggregateVersion,
            actualAggregateVersion: conflict.actualAggregateVersion,
            conflictReason: conflict.reason,
            reconciledAt: reconciledAt
        )
        var updated = envelopes
        updated[index].idempotencyKey = replacementIdempotencyKey
        updated[index].expectedAggregateVersion = expectedAggregateVersion
        updated[index].state = .pending
        updated[index].updatedAt = reconciledAt
        updated[index].nextAttemptAt = nil
        updated[index].conflict = nil
        updated[index].reconciliationHistory.append(reconciliation)
        try await commit(updated)
        return updated[index]
    }

    public func acknowledge(
        idempotencyKey: String,
        workerID: String,
        aggregateVersion: Int
    ) async throws -> OfflineCommandEnvelope {
        try await loadIfNeeded()
        guard let index = envelopes.firstIndex(where: { $0.idempotencyKey == idempotencyKey }) else {
            throw OfflineCommandQueueError.commandNotFound(idempotencyKey)
        }
        let current = envelopes[index]
        guard current.state == .sending else {
            throw OfflineCommandQueueError.invalidTransition(idempotencyKey: idempotencyKey, from: current.state, to: .acknowledged)
        }
        guard current.sendingWorkerID == workerID else {
            throw OfflineCommandQueueError.workerMismatch(expected: current.sendingWorkerID ?? "", actual: workerID)
        }
        guard aggregateVersion >= current.expectedAggregateVersion else {
            throw OfflineCommandQueueError.invalidDraft("aggregateVersion")
        }
        let acknowledgedAt = await clock.now()
        var updated = envelopes
        updated[index].state = .acknowledged
        updated[index].sendingWorkerID = nil
        updated[index].nextAttemptAt = nil
        updated[index].conflict = nil
        updated[index].updatedAt = acknowledgedAt
        updated[index].acknowledgement = OfflineCommandAcknowledgement(
            aggregateVersion: aggregateVersion,
            acknowledgedAt: acknowledgedAt
        )
        try await commit(updated)
        return updated[index]
    }
}
