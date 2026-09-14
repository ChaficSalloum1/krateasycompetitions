// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TournamentOSClient",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "TournamentOSClientCore", targets: ["TournamentOSClientCore"])],
    targets: [
        .target(name: "TournamentOSClientCore"),
        .testTarget(name: "TournamentOSClientCoreTests", dependencies: ["TournamentOSClientCore"]),
    ]
)
