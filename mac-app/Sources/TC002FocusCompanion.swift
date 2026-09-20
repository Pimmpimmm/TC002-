import Foundation
import AppKit

private let keychainService = "tc002-focus-bridge"

struct StoredConfig: Codable {
    var deviceIP = ""
    var hostIP = ""
    var focusMinutes = "45"
    var restMinutes = "5"
    var repoPath = ""
}

enum RunnerError: LocalizedError {
    case failed(String)
    var errorDescription: String? { if case .failed(let message) = self { return message }; return nil }
}

final class AppModel {
    var deviceIP = ""
    var hostIP = ""
    var focusMinutes = "45"
    var restMinutes = "5"
    var repoPath = ""
    var appID = ""
    var appSecret = ""
    var status = "等待配置"
    var logText = ""
    var isBusy = false
    var isAuthorized = false
    var onChange: (() -> Void)?
    private var oauthProcess: Process?

    func load() {
        let defaults = FileManager.default.currentDirectoryPath
        let configURL = supportDirectory().appendingPathComponent("config.json")
        if let data = try? Data(contentsOf: configURL), let config = try? JSONDecoder().decode(StoredConfig.self, from: data) {
            deviceIP = config.deviceIP; hostIP = config.hostIP; focusMinutes = config.focusMinutes; restMinutes = config.restMinutes; repoPath = config.repoPath
        }
        if repoPath.isEmpty || !FileManager.default.fileExists(atPath: repoPath) {
            let bundled = Bundle.main.resourceURL?.appendingPathComponent("tc002-repo").path ?? ""
            repoPath = FileManager.default.fileExists(atPath: bundled + "/companion/install-macos.sh")
                ? bundled
                : (FileManager.default.fileExists(atPath: defaults + "/companion/install-macos.sh") ? defaults : "")
        }
        if hostIP.isEmpty { hostIP = detectHostIP() }
        if appID.isEmpty { appID = (try? Self.run("/usr/bin/security", args: ["find-generic-password", "-s", keychainService, "-a", "app_id", "-w"]))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        isAuthorized = ["app_id", "app_secret", "user_open_id", "system_status_id"].allSatisfy { hasKeychainValue(account: $0) }
        notify()
    }

    func detectHost() { hostIP = detectHostIP(); appendLog("已自动识别电脑地址：\(hostIP)"); notify() }

    func authorizeLark() {
        guard !appID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { status = "请先填写 Lark App ID"; notify(); return }
        guard appSecret.count >= 8 else { status = "请先填写 Lark App Secret"; notify(); return }
        guard FileManager.default.fileExists(atPath: repoPath + "/bridge/oauth.mjs") else { status = "项目目录无效，找不到 bridge/oauth.mjs"; notify(); return }
        isBusy = true; status = "正在打开 Lark 授权页面…"; appendLog("App ID 和 App Secret 只写入 macOS 钥匙串，不写入项目文件。"); notify()
        let appID = self.appID; let appSecret = self.appSecret
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                _ = try Self.run("/usr/bin/security", args: ["add-generic-password", "-U", "-s", keychainService, "-a", "app_id", "-w", appID])
                _ = try Self.run("/usr/bin/security", args: ["add-generic-password", "-U", "-s", keychainService, "-a", "app_secret", "-w", appSecret])
                self.startOAuthProcess()
            } catch { self.updateOnMain { self.isBusy = false; self.status = "写入钥匙串失败：\(error.localizedDescription)"; self.notify() } }
        }
    }

    func startFocus() {
        guard let focus = Int(focusMinutes), let rest = Int(restMinutes), focus >= 1, rest >= 1 else { status = "专注和休息时长必须是正整数分钟"; notify(); return }
        guard !deviceIP.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { status = "请填写时钟 IP"; notify(); return }
        guard !hostIP.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { status = "请填写电脑 IP"; notify(); return }
        guard isAuthorized else { status = "请先完成 Lark 授权"; notify(); return }
        guard FileManager.default.fileExists(atPath: repoPath + "/companion/install-macos.sh") else { status = "项目目录无效，找不到 companion/install-macos.sh"; notify(); return }
        do { try Self.preflight(repo: repoPath) }
        catch { status = "启动前检查失败：\(error.localizedDescription)"; appendLog(error.localizedDescription); notify(); return }
        save(); isBusy = true; status = "正在启动本机服务并连接时钟…"; appendLog("准备启动：专注 \(focus) 分钟，休息 \(rest) 分钟，设备 \(deviceIP)"); notify()
        let focusSeconds = focus * 60; let restSeconds = rest * 60; let repo = repoPath; let device = deviceIP.contains(":") ? deviceIP : deviceIP + ":5555"; let host = hostIP
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let install = try Self.run("/bin/bash", args: [repo + "/companion/install-macos.sh", "--lan-host", host, "--mode", "real", "--focus-seconds", String(focusSeconds), "--rest-seconds", String(restSeconds), "--apply"], cwd: repo)
                self.updateOnMain { self.appendLog(install); self.notify() }
                let configure = try Self.run("/bin/bash", args: [repo + "/companion/configure-device.sh", "--adb-target", device, "--lan-host", host, "--focus-seconds", String(focusSeconds), "--rest-seconds", String(restSeconds)], cwd: repo)
                self.updateOnMain { self.appendLog(configure); self.notify() }
                let launch = try Self.run("/bin/bash", args: [repo + "/companion/start-focus.sh", "--adb-target", device], cwd: repo)
                self.updateOnMain { self.appendLog(launch); self.isBusy = false; self.status = "专注时钟已启动；设备重启后恢复原生界面"; self.notify() }
            } catch { self.updateOnMain { self.isBusy = false; self.status = "启动失败：\(error.localizedDescription)"; self.appendLog(error.localizedDescription); self.notify() } }
        }
    }

    func stopComputerServices() {
        let labels = ["com.tc002.focus-emqx", "com.tc002.focus-bridge", "com.tc002.focus-mqtt"]; let home = FileManager.default.homeDirectoryForCurrentUser.path
        isBusy = true; notify()
        DispatchQueue.global(qos: .userInitiated).async {
            for label in labels { _ = try? Self.run("/bin/launchctl", args: ["unload", home + "/Library/LaunchAgents/\(label).plist"]) }
            self.updateOnMain { self.isBusy = false; self.status = "电脑端助手已停止；时钟仍保持当前临时界面，重启时钟即可回原生"; self.notify() }
        }
    }

    func rebootDevice() {
        let target = deviceIP.contains(":") ? deviceIP : deviceIP + ":5555"; isBusy = true; status = "正在重启时钟，重启后会回到原生界面…"; notify()
        DispatchQueue.global(qos: .userInitiated).async {
            do { let adb = Self.adbPath(); let args = adb == "/usr/bin/env" ? ["adb", "-s", target, "reboot"] : ["-s", target, "reboot"]; _ = try Self.run(adb, args: args); self.updateOnMain { self.isBusy = false; self.status = "已发出重启命令；设备启动后应恢复原生界面"; self.notify() } }
            catch { self.updateOnMain { self.isBusy = false; self.status = "重启失败：\(error.localizedDescription)"; self.notify() } }
        }
    }

    func save() {
        let config = StoredConfig(deviceIP: deviceIP, hostIP: hostIP, focusMinutes: focusMinutes, restMinutes: restMinutes, repoPath: repoPath)
        do { let directory = supportDirectory(); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); try JSONEncoder().encode(config).write(to: directory.appendingPathComponent("config.json"), options: .atomic) }
        catch { appendLog("保存配置失败：\(error.localizedDescription)") }
    }

    private func startOAuthProcess() {
        let process = Process(); let node = Self.nodePath(); process.executableURL = URL(fileURLWithPath: node); process.arguments = node == "/usr/bin/env" ? ["node", repoPath + "/bridge/oauth.mjs"] : [repoPath + "/bridge/oauth.mjs"]
        var environment = ProcessInfo.processInfo.environment; environment["TC002_OPEN_BROWSER"] = "1"; environment["PATH"] = Self.toolPath(); process.environment = environment; process.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        process.terminationHandler = { [weak self] process in
            let data = pipe.fileHandleForReading.readDataToEndOfFile(); let output = String(data: data, encoding: .utf8) ?? ""
            self?.updateOnMain { self?.appendLog(output); self?.isBusy = false; if process.terminationStatus == 0 { self?.isAuthorized = true; self?.appSecret = ""; self?.status = "Lark 授权成功" } else { self?.status = "Lark 授权未完成，请查看日志" }; self?.notify() }
        }
        oauthProcess = process
        do { try process.run() } catch { updateOnMain { self.isBusy = false; self.status = "无法启动授权流程：\(error.localizedDescription)"; self.notify() } }
    }

    private func supportDirectory() -> URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TC002FocusCompanion", isDirectory: true) }
    private func hasKeychainValue(account: String) -> Bool { (try? Self.run("/usr/bin/security", args: ["find-generic-password", "-s", keychainService, "-a", account, "-w"])) != nil }
    private func detectHostIP() -> String { for interface in ["en0", "en1", "en2"] { if let value = try? Self.run("/usr/sbin/ipconfig", args: ["getifaddr", interface]), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return value.trimmingCharacters(in: .whitespacesAndNewlines) } }; return "" }
    private func appendLog(_ text: String) { guard !text.isEmpty else { return }; logText += (logText.isEmpty ? "" : "\n") + text }
    private func notify() { DispatchQueue.main.async { self.onChange?() } }
    private func updateOnMain(_ work: @escaping () -> Void) { DispatchQueue.main.async(execute: work) }

    private static func run(_ executable: String, args: [String] = [], cwd: String? = nil) throws -> String {
        let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = args; if let cwd { process.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        var environment = ProcessInfo.processInfo.environment; environment["PATH"] = toolPath(); process.environment = environment
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe; try process.run(); let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""; process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw RunnerError.failed(output.isEmpty ? "命令退出码：\(process.terminationStatus)" : output) }; return output
    }
    private static func preflight(repo: String) throws {
        let required = [
            "companion/install-macos.sh",
            "companion/configure-device.sh",
            "companion/start-focus.sh",
            "companion/verify-runtime-bundle.sh",
            "device/TC002_Focus_Probe/TemporaryFocusRelease/EasyUI.cfg",
            "device/TC002_Focus_Probe/TemporaryFocusRelease/lib/libzkgui.so",
            "device/TC002_Focus_Probe/TemporaryFocusRelease/ui/audio/focus_done.mp3"
        ]
        for relative in required where !FileManager.default.fileExists(atPath: repo + "/" + relative) {
            throw RunnerError.failed("发布包不完整，缺少 \(relative)")
        }
        let node = nodePath()
        let nodeArgs = node == "/usr/bin/env" ? ["node", "-p", "process.versions.node.split('.')[0]"] : ["-p", "process.versions.node.split('.')[0]"]
        let nodeMajor = Int(try run(node, args: nodeArgs).trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        guard nodeMajor >= 24 else { throw RunnerError.failed("需要 Node.js 24 或更高版本") }
        let adb = adbPath()
        _ = try run(adb, args: adb == "/usr/bin/env" ? ["adb", "version"] : ["version"])
        _ = try run("/usr/bin/env", args: ["brew", "--prefix", "emqx"])
        _ = try run("/bin/bash", args: [repo + "/companion/verify-runtime-bundle.sh"], cwd: repo)
    }
    private static func adbPath() -> String { ["/opt/homebrew/bin/adb", "/usr/local/bin/adb", "/usr/bin/adb"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/env" }
    private static func nodePath() -> String { ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/env" }
    private static func toolPath() -> String { "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" }
}

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = AppModel(); private var window: NSWindow!
    private let deviceField = NSTextField(); private let hostField = NSTextField(); private let focusField = NSTextField(); private let restField = NSTextField(); private let appIDField = NSTextField(); private let appSecretField = NSSecureTextField(); private let repoField = NSTextField(); private let statusField = NSTextField(labelWithString: ""); private let logView = NSTextView()
    private let startButton = NSButton(title: "启动专注时钟", target: nil, action: nil); private let stopButton = NSButton(title: "停止电脑助手", target: nil, action: nil); private let rebootButton = NSButton(title: "恢复原生界面（重启时钟）", target: nil, action: nil); private let authorizeButton = NSButton(title: "授权 Lark", target: nil, action: nil)

    static func main() { let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate; app.setActivationPolicy(.regular); withExtendedLifetime(delegate) { app.run() } }
    func applicationDidFinishLaunching(_ notification: Notification) { model.onChange = { [weak self] in self?.refresh() }; buildWindow(); model.load(); refresh() }

    private func buildWindow() {
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 600, height: 1100)); let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.documentView = content
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14; stack.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24), stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -24), stack.widthAnchor.constraint(equalToConstant: 552)])
        let title = NSTextField(labelWithString: "TC002 专注助手"); title.font = .systemFont(ofSize: 26, weight: .bold); stack.addArrangedSubview(title); let subtitle = NSTextField(labelWithString: "一键连接、临时启动；设备重启后自动回到原生界面"); subtitle.textColor = .secondaryLabelColor; stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(section("设备连接", [row("时钟 IP", deviceField, "例如 192.168.1.131"), rowWithButton("电脑 IP", hostField, "局域网地址", "自动识别", #selector(detectHost))]))
        stack.addArrangedSubview(section("专注时间", [row("专注（分钟）", focusField, "45"), row("休息（分钟）", restField, "5")]))
        stack.addArrangedSubview(section("Lark 账号", [row("App ID", appIDField, "每个人自己的 Lark App ID"), row("App Secret", appSecretField, "只用于授权，不写入配置文件"), buttonRow(authorizeButton)]))
        stack.addArrangedSubview(section("高级：项目目录", [row("项目目录", repoField, "Git 仓库目录")]))
        startButton.target = self; startButton.action = #selector(startFocus); startButton.keyEquivalent = "\r"; startButton.contentTintColor = .systemGreen; stopButton.target = self; stopButton.action = #selector(stopServices); rebootButton.target = self; rebootButton.action = #selector(reboot); rebootButton.contentTintColor = .systemRed
        let actions = NSStackView(views: [startButton, stopButton]); actions.orientation = .horizontal; actions.spacing = 12; actions.distribution = .fillEqually; stack.addArrangedSubview(actions); stack.addArrangedSubview(rebootButton)
        let statusBox = NSBox(); statusBox.title = "状态"; statusBox.contentViewMargins = NSSize(width: 12, height: 12); statusField.heightAnchor.constraint(equalToConstant: 28).isActive = true; statusBox.contentView = statusField; statusBox.widthAnchor.constraint(equalToConstant: 552).isActive = true; statusBox.heightAnchor.constraint(equalToConstant: 72).isActive = true; stack.addArrangedSubview(statusBox)
        logView.isEditable = false; logView.isRichText = false; logView.font = .monospacedSystemFont(ofSize: 11, weight: .regular); logView.textColor = .secondaryLabelColor; let logScroll = NSScrollView(); logScroll.hasVerticalScroller = true; logScroll.documentView = logView; logScroll.heightAnchor.constraint(equalToConstant: 120).isActive = true; stack.addArrangedSubview(logScroll)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false); window.title = "TC002 专注助手"; window.contentView = scroll; window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    private func section(_ title: String, _ rows: [NSView]) -> NSBox {
        let box = NSBox()
        box.title = title
        box.contentViewMargins = NSSize(width: 12, height: 12)
        let inner = NSView()
        let rowsStack = NSStackView(views: rows)
        rowsStack.orientation = .vertical
        rowsStack.alignment = .leading
        rowsStack.spacing = 8
        rowsStack.translatesAutoresizingMaskIntoConstraints = false
        inner.addSubview(rowsStack)
        NSLayoutConstraint.activate([
            rowsStack.leadingAnchor.constraint(equalTo: inner.leadingAnchor),
            rowsStack.trailingAnchor.constraint(equalTo: inner.trailingAnchor),
            rowsStack.topAnchor.constraint(equalTo: inner.topAnchor),
            rowsStack.bottomAnchor.constraint(equalTo: inner.bottomAnchor)
        ])
        box.contentView = inner
        box.widthAnchor.constraint(equalToConstant: 552).isActive = true
        let rowCount = max(rows.count, 1)
        let contentHeight = CGFloat(rowCount * 28 + max(rowCount - 1, 0) * 8)
        box.heightAnchor.constraint(equalToConstant: contentHeight + 48).isActive = true
        return box
    }
    private func row(_ title: String, _ field: NSTextField, _ placeholder: String) -> NSView { field.placeholderString = placeholder; field.widthAnchor.constraint(equalToConstant: 360).isActive = true; field.heightAnchor.constraint(equalToConstant: 28).isActive = true; return rowLabel(title, field) }
    private func rowWithButton(_ title: String, _ field: NSTextField, _ placeholder: String, _ buttonTitle: String, _ action: Selector) -> NSView { let row = NSStackView(); row.orientation = .horizontal; row.spacing = 8; field.placeholderString = placeholder; field.widthAnchor.constraint(equalToConstant: 270).isActive = true; field.heightAnchor.constraint(equalToConstant: 28).isActive = true; row.addArrangedSubview(label(title)); row.addArrangedSubview(field); row.addArrangedSubview(NSButton(title: buttonTitle, target: self, action: action)); return row }
    private func rowLabel(_ title: String, _ view: NSView) -> NSView { let row = NSStackView(views: [label(title), view]); row.orientation = .horizontal; row.spacing = 8; return row }
    private func label(_ text: String) -> NSTextField { let field = NSTextField(labelWithString: text); field.widthAnchor.constraint(equalToConstant: 100).isActive = true; field.heightAnchor.constraint(equalToConstant: 28).isActive = true; return field }
    private func buttonRow(_ button: NSButton) -> NSView { button.target = self; button.action = #selector(authorize); return button }
    private func collectFields() { model.deviceIP = deviceField.stringValue; model.hostIP = hostField.stringValue; model.focusMinutes = focusField.stringValue; model.restMinutes = restField.stringValue; model.appID = appIDField.stringValue; model.appSecret = appSecretField.stringValue; model.repoPath = repoField.stringValue }
    private func refresh() { DispatchQueue.main.async { self.deviceField.stringValue = self.model.deviceIP; self.hostField.stringValue = self.model.hostIP; self.focusField.stringValue = self.model.focusMinutes; self.restField.stringValue = self.model.restMinutes; self.appIDField.stringValue = self.model.appID; self.repoField.stringValue = self.model.repoPath; self.statusField.stringValue = self.model.status; self.logView.string = self.model.logText; self.authorizeButton.title = self.model.isAuthorized ? "重新授权 Lark" : "授权 Lark"; self.startButton.isEnabled = !self.model.isBusy; self.stopButton.isEnabled = !self.model.isBusy; self.rebootButton.isEnabled = !self.model.isBusy } }
    @objc private func detectHost() { model.detectHost() }
    @objc private func authorize() { collectFields(); model.authorizeLark() }
    @objc private func startFocus() { collectFields(); model.startFocus() }
    @objc private func stopServices() { model.stopComputerServices() }
    @objc private func reboot() { let alert = NSAlert(); alert.messageText = "确认重启时钟？"; alert.informativeText = "重启只会让临时程序消失，不会刷写固件。"; alert.addButton(withTitle: "重启"); alert.addButton(withTitle: "取消"); if alert.runModal() == .alertFirstButtonReturn { collectFields(); model.rebootDevice() } }
}
