import SwiftUI
import TournamentOSClientCore

@main
struct TournamentOSClientApp: App {
    var body: some Scene {
        WindowGroup {
            TournamentOSAppShell()
        }
        #if os(macOS)
        .defaultSize(width: 1180, height: 760)
        #endif
    }
}
