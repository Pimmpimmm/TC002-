// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TC002FocusCompanion",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "TC002FocusCompanion", targets: ["TC002FocusCompanion"])
    ],
    targets: [
        .executableTarget(
            name: "TC002FocusCompanion",
            path: "Sources"
        )
    ]
)
