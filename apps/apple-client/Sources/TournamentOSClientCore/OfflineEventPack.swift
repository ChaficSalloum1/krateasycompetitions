import CryptoKit
import Foundation

public struct SignedOfflineEventPackDTO: Codable, Equatable, Sendable {
    public let apiVersion: String
    public let algorithm: String
    public let keyId: String
    public let publicKeyBase64: String
    public let payloadBase64: String
    public let signatureBase64: String

    public init(apiVersion: String, algorithm: String, keyId: String, publicKeyBase64: String,
                payloadBase64: String, signatureBase64: String) {
        self.apiVersion = apiVersion
        self.algorithm = algorithm
        self.keyId = keyId
        self.publicKeyBase64 = publicKeyBase64
        self.payloadBase64 = payloadBase64
        self.signatureBase64 = signatureBase64
    }
}

public struct OfflineEventPackAuthorityDTO: Codable, Equatable, Sendable {
    public let publicationCertificateHash: String
    public let definitionHash: String
    public let guardReportHash: String
    public let stateProofHash: String
}

public struct OfflinePublicContestDTO: Codable, Equatable, Sendable, Identifiable {
    public var id: String { contestId }
    public let contestId: String
    public let participantNames: [String]
    public let court: String
    public let startsAt: String
    public let status: String
    public let revision: Int
    public let projectionHash: String
}

public struct OfflinePublicProjectionDTO: Codable, Equatable, Sendable {
    public let publishedRevision: Int
    public let operationalRevision: Int
    public let contests: [OfflinePublicContestDTO]
    public let projectionHash: String
}

public struct OfflineParticipantNextDTO: Codable, Equatable, Sendable {
    public let contestId: String
    public let opponent: String?
    public let court: String
    public let reportingTime: String
    public let startsAt: String
    public let status: String
}

public struct OfflineParticipantProjectionDTO: Codable, Equatable, Sendable {
    public struct Participant: Codable, Equatable, Sendable {
        public let displayName: String
        public let status: String
    }
    public let participant: Participant
    public let revision: Int
    public let next: OfflineParticipantNextDTO?
    public let projectionHash: String
}

public struct OfflineParticipantLookupDTO: Codable, Equatable, Sendable, Identifiable {
    public var id: String { participantId }
    public let participantId: String
    public let projection: OfflineParticipantProjectionDTO
}

public struct OfflineEmergencyReadinessDTO: Codable, Equatable, Sendable {
    public let status: String
    public let missingDecisionCodes: [String]
    public let emergencyContacts: [String]
    public let instructions: [String]
}

public struct OfflineEventPackBodyDTO: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let organizationId: String
    public let competitionId: String
    public let competitionName: String
    public let publishedRevision: Int
    public let operationalRevision: Int
    public let liveVersion: Int
    public let generatedAt: String
    public let expiresAt: String
    public let timezone: String
    public let authority: OfflineEventPackAuthorityDTO
    public let publicProjection: OfflinePublicProjectionDTO
    public let participantLookup: [OfflineParticipantLookupDTO]
    public let emergencyReadiness: OfflineEmergencyReadinessDTO
}

public struct VerifiedOfflineEventPack: Equatable, Sendable {
    public let envelope: SignedOfflineEventPackDTO
    public let body: OfflineEventPackBodyDTO
}

public enum OfflineEventPackError: Error, Equatable, Sendable {
    case trustNotConfigured
    case trustMismatch
    case signatureInvalid
    case invalidPayload
    case scopeMismatch
    case revisionMismatch
    case expired
}

public struct OfflineEventPackVerifier: Sendable {
    private let trustedPublicKey: Data

    public init(trustedPublicKey: Data) {
        self.trustedPublicKey = trustedPublicKey
    }

    public func verify(_ envelope: SignedOfflineEventPackDTO, organizationID: String, competitionID: String,
                       publishedRevision: Int, operationalRevision: Int, now: Date = Date()) throws -> VerifiedOfflineEventPack {
        guard trustedPublicKey.count == 32 else { throw OfflineEventPackError.trustNotConfigured }
        guard envelope.apiVersion == "1.0", envelope.algorithm == "Ed25519",
              let suppliedKey = Data(base64Encoded: envelope.publicKeyBase64), suppliedKey == trustedPublicKey else {
            throw OfflineEventPackError.trustMismatch
        }
        let keyID = "sha256:\(SHA256.hash(data: trustedPublicKey).map { String(format: "%02x", $0) }.joined())"
        guard envelope.keyId == keyID else { throw OfflineEventPackError.trustMismatch }
        guard let payload = Data(base64Encoded: envelope.payloadBase64),
              let signature = Data(base64Encoded: envelope.signatureBase64), signature.count == 64,
              let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: trustedPublicKey),
              publicKey.isValidSignature(signature, for: payload) else { throw OfflineEventPackError.signatureInvalid }
        guard let body = try? JSONDecoder().decode(OfflineEventPackBodyDTO.self, from: payload),
              body.schemaVersion == "1.0.0", body.publicProjection.publishedRevision == body.publishedRevision,
              body.publicProjection.operationalRevision == body.operationalRevision,
              body.emergencyReadiness.status == "BLOCKED_MISSING_AUTHORITY_DATA",
              let generatedAt = Self.date(body.generatedAt), let expiresAt = Self.date(body.expiresAt),
              generatedAt <= now else { throw OfflineEventPackError.invalidPayload }
        guard body.organizationId == organizationID, body.competitionId == competitionID else {
            throw OfflineEventPackError.scopeMismatch
        }
        guard body.publishedRevision == publishedRevision, body.operationalRevision == operationalRevision else {
            throw OfflineEventPackError.revisionMismatch
        }
        guard expiresAt > now else { throw OfflineEventPackError.expired }
        return VerifiedOfflineEventPack(envelope: envelope, body: body)
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}

public struct FileOfflineEventPackStore: Sendable {
    private let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func save(_ envelope: SignedOfflineEventPackDTO) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder.sorted.encode(envelope)
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    public func load() throws -> SignedOfflineEventPackDTO? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try JSONDecoder().decode(SignedOfflineEventPackDTO.self, from: Data(contentsOf: fileURL))
    }
}

private extension JSONEncoder {
    static var sorted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
