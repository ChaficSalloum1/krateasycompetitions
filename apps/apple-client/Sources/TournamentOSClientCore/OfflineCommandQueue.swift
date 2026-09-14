import Foundation
import CryptoKit

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

public struct OfflineLiveScore: Sendable, Equatable {
    public let entrantID: String
    public let value: Int

    public init(entrantID: String, value: Int) {
        self.entrantID = entrantID
        self.value = value
    }
}

public enum OfflineLiveCommandAction: Sendable, Equatable {
    case checkIn(entrantID: String)
    case call(contestID: String)
    case start(contestID: String, courtID: String, startedAt: String)
    case score(contestID: String, scores: [OfflineLiveScore])
    case finish(contestID: String, endedAt: String)
    case walkover(contestID: String, winnerEntrantID: String, absentEntrantID: String, reason: String)
    case correction(supersedesEventID: String, reason: String, contestID: String,
                    scores: [OfflineLiveScore], replacementReason: String)

    fileprivate var commandName: String {
        switch self {
        case .checkIn: "CHECK_IN"
        case .call: "CALL_CONTEST"
        case .start: "START_CONTEST"
        case .score: "RECORD_SCORE"
        case .finish: "COMPLETE_CONTEST"
        case .walkover: "AWARD_WALKOVER"
        case .correction: "CORRECT_OPERATION"
        }
    }

    fileprivate func object(idempotencyKey: String, expectedVersion: Int) -> [String: Any] {
        var result: [String: Any] = [
            "kind": commandName,
            "commandId": idempotencyKey,
            "expectedVersion": expectedVersion,
        ]
        switch self {
        case .checkIn(let entrantID): result["entrantId"] = entrantID
        case .call(let contestID): result["contestId"] = contestID
        case .start(let contestID, let courtID, let startedAt):
            result["contestId"] = contestID; result["courtId"] = courtID; result["startedAt"] = startedAt
        case .score(let contestID, let scores):
            result["contestId"] = contestID
            result["scores"] = scores.map { ["entrantId": $0.entrantID, "value": $0.value] }
        case .finish(let contestID, let endedAt):
            result["contestId"] = contestID; result["endedAt"] = endedAt
        case .walkover(let contestID, let winnerEntrantID, let absentEntrantID, let reason):
            result["contestId"] = contestID; result["winnerEntrantId"] = winnerEntrantID
            result["absentEntrantId"] = absentEntrantID; result["reason"] = reason
        case .correction(let supersedesEventID, let reason, let contestID, let scores, let replacementReason):
            result["supersedesEventId"] = supersedesEventID; result["reason"] = reason
            result["replacement"] = [
                "kind": "SET_CONTEST_SCORE",
                "contestId": contestID,
                "scores": scores.map { ["entrantId": $0.entrantID, "value": $0.value] },
                "reason": replacementReason,
            ]
        }
        return result
    }
}

public extension OfflineCommandDraft {
    static func live(
        idempotencyKey: String,
        competitionID: String,
        publishedRevision: Int,
        expectedLiveVersion: Int,
        action: OfflineLiveCommandAction
    ) throws -> OfflineCommandDraft {
        guard !idempotencyKey.isEmpty, !competitionID.isEmpty, publishedRevision >= 1,
              expectedLiveVersion >= 0 else { throw OfflineCommandQueueError.invalidDraft("liveCommand") }
        let object: [String: Any] = [
            "expectedRevision": publishedRevision,
            "command": action.object(idempotencyKey: idempotencyKey, expectedVersion: expectedLiveVersion),
        ]
        guard JSONSerialization.isValidJSONObject(object) else {
            throw OfflineCommandQueueError.invalidDraft("liveCommand")
        }
        let payload = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return OfflineCommandDraft(
            idempotencyKey: idempotencyKey,
            aggregateID: competitionID,
            expectedAggregateVersion: expectedLiveVersion,
            commandName: action.commandName,
            payload: payload
        )
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
    public var payload: Data
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

public struct OfflineCommandQueueScope: Codable, Sendable, Equatable {
    public let organizationID: String
    public let competitionID: String

    public init(organizationID: String, competitionID: String) {
        self.organizationID = organizationID
        self.competitionID = competitionID
    }
}

public enum OfflineCommandPersistenceError: Error, Sendable, Equatable {
    case invalidScope
    case scopeMismatch
    case integrityCheckFailed
    case invalidJournal
}

private struct OfflineCommandJournal: Codable {
    let schemaVersion: String
    let scope: OfflineCommandQueueScope
    let envelopes: [OfflineCommandEnvelope]
    let envelopesHash: String
}

public actor FileOfflineCommandQueuePersistence: OfflineCommandQueuePersistence {
    private let fileURL: URL
    private let scope: OfflineCommandQueueScope
    private let fileManager: FileManager

    public init(fileURL: URL, scope: OfflineCommandQueueScope, fileManager: FileManager = .default) throws {
        guard fileURL.isFileURL, !scope.organizationID.isEmpty, !scope.competitionID.isEmpty else {
            throw OfflineCommandPersistenceError.invalidScope
        }
        self.fileURL = fileURL
        self.scope = scope
        self.fileManager = fileManager
    }

    public func load() throws -> [OfflineCommandEnvelope] {
        guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
        let journal = try JSONDecoder.offlineJournal.decode(
            OfflineCommandJournal.self,
            from: Data(contentsOf: fileURL, options: [.mappedIfSafe])
        )
        guard journal.schemaVersion == "1.0.0", journal.scope == scope else {
            throw OfflineCommandPersistenceError.scopeMismatch
        }
        guard try Self.hash(journal.envelopes) == journal.envelopesHash else {
            throw OfflineCommandPersistenceError.integrityCheckFailed
        }
        try validate(journal.envelopes)
        return journal.envelopes
    }

    public func save(_ envelopes: [OfflineCommandEnvelope]) throws {
        try validate(envelopes)
        let journal = OfflineCommandJournal(
            schemaVersion: "1.0.0",
            scope: scope,
            envelopes: envelopes,
            envelopesHash: try Self.hash(envelopes)
        )
        try fileManager.createDirectory(at: fileURL.deletingLastPathComponent(),
                                        withIntermediateDirectories: true)
        let data = try JSONEncoder.offlineJournal.encode(journal)
        try data.write(to: fileURL, options: [.atomic])
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    private func validate(_ envelopes: [OfflineCommandEnvelope]) throws {
        guard envelopes.allSatisfy({ $0.aggregateID == scope.competitionID }) else {
            throw OfflineCommandPersistenceError.scopeMismatch
        }
        let ids = Set(envelopes.map(\.id))
        let currentKeys = Set(envelopes.map(\.idempotencyKey))
        let ownedKeySets = envelopes.map { envelope in
            Set([envelope.idempotencyKey] + envelope.reconciliationHistory.flatMap {
                [$0.previousIdempotencyKey, $0.replacementIdempotencyKey]
            })
        }
        let allOwnedKeys = ownedKeySets.reduce(into: Set<String>()) { $0.formUnion($1) }
        guard ids.count == envelopes.count, currentKeys.count == envelopes.count,
              allOwnedKeys.count == ownedKeySets.reduce(0, { $0 + $1.count }),
              envelopes.allSatisfy({ envelope in
                  !envelope.idempotencyKey.isEmpty && envelope.idempotencyKey.count <= 256
                      && !envelope.commandName.isEmpty && envelope.commandName.count <= 128
                      && !envelope.aggregateID.isEmpty && envelope.aggregateID.count <= 256
                      && envelope.payload.count <= 64_000
                      && envelope.expectedAggregateVersion >= 0 && envelope.attemptCount >= 0
                      && ((envelope.state == .sending) == (envelope.sendingWorkerID != nil))
                      && ((envelope.state == .conflicted) == (envelope.conflict != nil))
                      && ((envelope.state == .acknowledged) == (envelope.acknowledgement != nil))
                      && Self.validReconciliationChain(envelope)
              }) else {
            throw OfflineCommandPersistenceError.invalidJournal
        }
    }

    private static func validReconciliationChain(_ envelope: OfflineCommandEnvelope) -> Bool {
        guard let first = envelope.reconciliationHistory.first else { return true }
        guard !first.previousIdempotencyKey.isEmpty else { return false }
        for (left, right) in zip(envelope.reconciliationHistory, envelope.reconciliationHistory.dropFirst())
            where left.replacementIdempotencyKey != right.previousIdempotencyKey { return false }
        return envelope.reconciliationHistory.last?.replacementIdempotencyKey == envelope.idempotencyKey
    }

    private static func hash(_ envelopes: [OfflineCommandEnvelope]) throws -> String {
        let digest = SHA256.hash(data: try JSONEncoder.offlineJournal.encode(envelopes))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

private extension JSONEncoder {
    static var offlineJournal: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

private extension JSONDecoder {
    static var offlineJournal: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }
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

public struct OfflineCommandReceipt: Sendable, Equatable {
    public let aggregateVersion: Int

    public init(aggregateVersion: Int) {
        self.aggregateVersion = aggregateVersion
    }
}

public enum OfflineCommandTransportError: Error, Sendable, Equatable {
    case unavailable
    case rejected(actualAggregateVersion: Int, reason: String)
}

public protocol OfflineCommandTransport: Sendable {
    func submit(_ envelope: OfflineCommandEnvelope) async throws -> OfflineCommandReceipt
}

public enum OfflineCommandSyncResult: Sendable, Equatable {
    case idle
    case acknowledged(OfflineCommandEnvelope)
    case conflicted(OfflineCommandEnvelope)
    case retryScheduled(OfflineCommandEnvelope)
}

public actor OfflineCommandSynchronizer {
    private let queue: OfflineCommandQueue
    private let transport: any OfflineCommandTransport
    private let workerID: String
    private let retryDelay: TimeInterval

    public init(queue: OfflineCommandQueue, transport: any OfflineCommandTransport,
                workerID: String, retryDelay: TimeInterval = 5) {
        self.queue = queue
        self.transport = transport
        self.workerID = workerID
        self.retryDelay = retryDelay
    }

    public func syncNext() async throws -> OfflineCommandSyncResult {
        guard !workerID.isEmpty, retryDelay.isFinite, retryDelay >= 0 else {
            throw OfflineCommandQueueError.invalidDraft("synchronizer")
        }
        guard let claimed = try await queue.claimNext(workerID: workerID) else { return .idle }
        do {
            let receipt = try await transport.submit(claimed)
            return .acknowledged(try await queue.acknowledge(
                idempotencyKey: claimed.idempotencyKey,
                workerID: workerID,
                aggregateVersion: receipt.aggregateVersion
            ))
        } catch OfflineCommandTransportError.rejected(let actualVersion, let reason) {
            return .conflicted(try await queue.markConflicted(
                idempotencyKey: claimed.idempotencyKey,
                workerID: workerID,
                actualAggregateVersion: actualVersion,
                reason: reason
            ))
        } catch {
            return .retryScheduled(try await queue.retry(
                idempotencyKey: claimed.idempotencyKey,
                workerID: workerID,
                error: "The authoritative server did not acknowledge this command.",
                delay: retryDelay
            ))
        }
    }
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
        if envelopes.contains(where: { $0.state == .sending }) {
            let recoveredAt = await clock.now()
            for index in envelopes.indices where envelopes[index].state == .sending {
                envelopes[index].state = .pending
                envelopes[index].sendingWorkerID = nil
                envelopes[index].nextAttemptAt = nil
                envelopes[index].updatedAt = recoveredAt
                envelopes[index].lastError = "Recovered an interrupted send before acknowledgement."
            }
            try await persistence.save(envelopes)
        }
        isLoaded = true
    }

    private func sortEnvelopes(_ values: inout [OfflineCommandEnvelope]) {
        values.sort {
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    private func validate(_ draft: OfflineCommandDraft) throws {
        guard !draft.idempotencyKey.isEmpty, draft.idempotencyKey.count <= 256 else {
            throw OfflineCommandQueueError.invalidDraft("idempotencyKey")
        }
        guard !draft.aggregateID.isEmpty, draft.aggregateID.count <= 256 else {
            throw OfflineCommandQueueError.invalidDraft("aggregateID")
        }
        guard draft.expectedAggregateVersion >= 0 else { throw OfflineCommandQueueError.invalidDraft("expectedAggregateVersion") }
        guard !draft.commandName.isEmpty, draft.commandName.count <= 128 else {
            throw OfflineCommandQueueError.invalidDraft("commandName")
        }
        guard draft.payload.count <= 64_000 else { throw OfflineCommandQueueError.invalidDraft("payload") }
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
        guard let index = envelopes.indices.first(where: { index in
            let candidate = envelopes[index]
            return candidate.state == .pending
                && (candidate.nextAttemptAt == nil || candidate.nextAttemptAt! <= claimedAt)
                && !envelopes[..<index].contains(where: {
                    $0.aggregateID == candidate.aggregateID && $0.state != .acknowledged
                })
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
        updated[index].payload = reconciledPayload(
            current.payload,
            previousIdempotencyKey: current.idempotencyKey,
            replacementIdempotencyKey: replacementIdempotencyKey,
            previousExpectedVersion: current.expectedAggregateVersion,
            replacementExpectedVersion: expectedAggregateVersion
        )
        updated[index].state = .pending
        updated[index].updatedAt = reconciledAt
        updated[index].nextAttemptAt = nil
        updated[index].conflict = nil
        updated[index].reconciliationHistory.append(reconciliation)
        try await commit(updated)
        return updated[index]
    }

    private func reconciledPayload(
        _ payload: Data,
        previousIdempotencyKey: String,
        replacementIdempotencyKey: String,
        previousExpectedVersion: Int,
        replacementExpectedVersion: Int
    ) -> Data {
        guard var body = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
              var command = body["command"] as? [String: Any],
              command["commandId"] as? String == previousIdempotencyKey,
              command["expectedVersion"] as? Int == previousExpectedVersion else { return payload }
        command["commandId"] = replacementIdempotencyKey
        command["expectedVersion"] = replacementExpectedVersion
        body["command"] = command
        return (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? payload
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
