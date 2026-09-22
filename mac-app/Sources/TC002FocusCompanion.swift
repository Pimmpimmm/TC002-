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

enum EnvironmentError: LocalizedError {
    case missingTool(name: String, brewPackage: String)
    case nodeTooOld(version: String)

    var errorDescription: String? {
        switch self {
        case .missingTool(let name, _): return "未找到 \(name)"
        case .nodeTooOld(let version): return "需要 Node.js 24 或更高版本，当前为 \(version)"
        }
    }

    var brewPackages: [String] {
        switch self {
        case .missingTool(_, let package): return [package]
        case .nodeTooOld: return ["node"]
        }
    }
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
    var isLarkVerified = false
    var isEnvironmentReady = false
    var isDeviceReachable = false
    var areServicesInstalled = false
    var areServicesRunning = false
    var onChange: (() -> Void)?
    var onEnvironmentInstallOffer: (([String], String) -> Void)?
    private var oauthProcess: Process?
    private var restartOAuthWhenStopped = false

    var isOAuthRunning: Bool { oauthProcess?.isRunning == true }
    var isReadyToStart: Bool {
        isEnvironmentReady && isLarkVerified && isDeviceReachable
            && !deviceIP.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !hostIP.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

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
        refreshAuthorizationState()
        let serviceLabels = ["com.tc002.focus-emqx", "com.tc002.focus-bridge", "com.tc002.focus-mqtt"]
        let launchAgents = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        areServicesInstalled = serviceLabels.allSatisfy {
            FileManager.default.fileExists(atPath: launchAgents.appendingPathComponent("\($0).plist").path)
        }
        areServicesRunning = serviceLabels.allSatisfy {
            (try? Self.run("/bin/launchctl", args: ["list", $0])) != nil
        }
        status = isAuthorized ? "Lark 凭据已保存；启动前会再验证权限" : "请从第 1 步开始配置"
        notify()
    }

    func autoValidateSavedConfiguration() {
        guard !isBusy else { return }
        let repo = repoPath
        let device = deviceIP.trimmingCharacters(in: .whitespacesAndNewlines)
        let host = hostIP.trimmingCharacters(in: .whitespacesAndNewlines)
        let shouldCheckDevice = !device.isEmpty && !host.isEmpty
        let storedAppID = keychainValue(account: "app_id") ?? ""
        let shouldCheckLark = isAuthorized && !appID.isEmpty && storedAppID == appID
        isBusy = true
        status = "正在自动检查已保存的配置…"
        appendLog("启动检查：正在验证运行环境。")
        notify()

        DispatchQueue.global(qos: .userInitiated).async {
            var environmentError: Error?
            var environmentReady = false
            var deviceReachable = false
            var larkVerified = false
            var messages: [String] = []

            do {
                try Self.preflight(repo: repo)
                environmentReady = true
                messages.append("✓ 运行环境检查通过")
            } catch {
                environmentError = error
                messages.append("运行环境未通过：\(Self.friendlyError(error.localizedDescription))")
            }

            if shouldCheckDevice {
                do {
                    let target = device.contains(":") ? device : device + ":5555"
                    let adb = Self.adbPath()
                    _ = try Self.run(adb, args: adb == "/usr/bin/env" ? ["adb", "connect", target] : ["connect", target])
                    let state = try Self.run(adb, args: adb == "/usr/bin/env" ? ["adb", "-s", target, "get-state"] : ["-s", target, "get-state"])
                    guard state.trimmingCharacters(in: .whitespacesAndNewlines) == "device" else { throw RunnerError.failed("ADB 未返回 device 状态") }
                    deviceReachable = true
                    messages.append("✓ TC002 自动连接检查通过")
                } catch {
                    messages.append("TC002 自动检查未通过：\(error.localizedDescription)")
                }
            }

            if shouldCheckLark {
                do {
                    let node = Self.nodePath()
                    let args = node == "/usr/bin/env" ? ["node", repo + "/bridge/setup-system-status.mjs"] : [repo + "/bridge/setup-system-status.mjs"]
                    let output = try Self.run(node, args: args, cwd: repo)
                    larkVerified = true
                    messages.append(output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "✓ Lark 自动验证通过" : output.trimmingCharacters(in: .whitespacesAndNewlines))
                } catch {
                    messages.append("Lark 自动验证未通过：\(error.localizedDescription)")
                }
            }

            self.updateOnMain {
                self.isEnvironmentReady = environmentReady
                if shouldCheckDevice { self.isDeviceReachable = deviceReachable }
                if shouldCheckLark { self.isLarkVerified = larkVerified }
                self.isBusy = false
                messages.forEach { self.appendLog($0) }
                if self.isReadyToStart {
                    self.status = "自动检查通过，可以直接点击“启动专注时钟”"
                } else if environmentReady {
                    self.status = "自动检查完成；请继续填写或验证尚未就绪的项目"
                } else {
                    self.status = "运行环境检查未通过，请查看日志"
                }
                self.notify()
                if let issue = environmentError as? EnvironmentError {
                    self.onEnvironmentInstallOffer?(issue.brewPackages, Self.friendlyError(issue.localizedDescription))
                }
            }
        }
    }

    var readinessSummary: String {
        let environment = isEnvironmentReady ? "✓ 运行环境就绪" : "○ 待检查运行环境"
        let lark = isLarkVerified ? "✓ Lark 权限与系统状态正常" : (isAuthorized ? "◐ Lark 凭据已保存，待验证" : "○ 待授权 Lark")
        let device = isDeviceReachable ? "✓ TC002 可连接" : "○ 待测试 TC002 连接"
        let services = areServicesRunning ? "✓ 电脑助手正在运行" : (isReadyToStart ? "✓ 配置已验证，可以启动" : (areServicesInstalled ? "○ 电脑助手已停止" : "○ 电脑助手将在首次启动时安装"))
        return [environment, lark, device, services].joined(separator: "\n")
    }

    func detectHost() {
        hostIP = detectHostIP()
        if hostIP.isEmpty {
            status = "未自动识别到局域网 IPv4，请手动填写"
        } else {
            status = "已自动识别电脑地址：\(hostIP)"
            appendLog(status)
        }
        notify()
    }

    func checkEnvironment() {
        guard !isBusy else { return }
        isBusy = true; status = "正在检查 Node.js、ADB、EMQX 和运行包…"; notify()
        let repo = repoPath
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try Self.preflight(repo: repo)
                self.updateOnMain { self.isEnvironmentReady = true; self.isBusy = false; self.status = "运行环境检查通过"; self.appendLog("环境检查：Node.js、ADB、EMQX 和 TC002 运行包均正常。"); self.notify() }
            } catch {
                self.updateOnMain {
                    self.isEnvironmentReady = false; self.isBusy = false
                    let message = Self.friendlyError(error.localizedDescription)
                    self.status = "环境检查未通过：\(error.localizedDescription)"
                    self.appendLog(message); self.notify()
                    if let issue = error as? EnvironmentError { self.onEnvironmentInstallOffer?(issue.brewPackages, message) }
                }
            }
        }
    }

    func installEnvironment(packages: [String]) {
        guard !isBusy else { return }
        guard let brew = Self.resolvedExecutable("brew", preferred: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) else {
            status = "未找到 Homebrew，无法自动安装"
            appendLog("请先从 https://brew.sh 安装 Homebrew，再重新检查运行环境。")
            notify(); return
        }
        let uniquePackages = Array(Set(packages)).sorted()
        guard !uniquePackages.isEmpty else { return }
        isBusy = true; status = "正在安装：\(uniquePackages.joined(separator: "、"))…"; notify()
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                for package in uniquePackages {
                    let args = package == "android-platform-tools" ? ["install", "--cask", package] : ["install", package]
                    let output = try Self.run(brew, args: args)
                    self.updateOnMain { self.appendLog(output); self.notify() }
                }
                try Self.preflight(repo: self.repoPath)
                self.updateOnMain { self.isEnvironmentReady = true; self.isBusy = false; self.status = "安装完成，运行环境检查通过"; self.appendLog("缺少的组件已经安装并验证通过。"); self.notify() }
            } catch {
                self.updateOnMain { self.isEnvironmentReady = false; self.isBusy = false; self.status = "自动安装未完成"; self.appendLog(Self.friendlyError(error.localizedDescription)); self.notify() }
            }
        }
    }

    func checkDevice() {
        let value = deviceIP.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { status = "请先填写时钟 IP"; notify(); return }
        guard !isBusy else { return }
        let target = value.contains(":") ? value : value + ":5555"
        isBusy = true; status = "正在测试 TC002 连接…"; notify()
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let adb = Self.adbPath()
                _ = try Self.run(adb, args: adb == "/usr/bin/env" ? ["adb", "connect", target] : ["connect", target])
                let state = try Self.run(adb, args: adb == "/usr/bin/env" ? ["adb", "-s", target, "get-state"] : ["-s", target, "get-state"])
                guard state.trimmingCharacters(in: .whitespacesAndNewlines) == "device" else { throw RunnerError.failed("ADB 未返回 device 状态") }
                self.updateOnMain { self.isDeviceReachable = true; self.isBusy = false; self.status = "TC002 连接正常"; self.appendLog("时钟连接检查通过：\(target)"); self.notify() }
            } catch {
                self.updateOnMain { self.isDeviceReachable = false; self.isBusy = false; self.status = "TC002 连接失败"; self.appendLog(error.localizedDescription); self.notify() }
            }
        }
    }

    func verifyLark() {
        guard isAuthorized else { status = "请先完成 Lark 授权"; notify(); return }
        guard keychainValue(account: "app_id") == appID else { isLarkVerified = false; status = "App ID 已修改，请先重新授权 Lark"; notify(); return }
        guard !isBusy else { return }
        isBusy = true; status = "正在验证 Lark 权限和“专注中”状态…"; notify()
        let repo = repoPath
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let node = Self.nodePath()
                let args = node == "/usr/bin/env" ? ["node", repo + "/bridge/setup-system-status.mjs"] : [repo + "/bridge/setup-system-status.mjs"]
                let output = try Self.run(node, args: args, cwd: repo)
                self.updateOnMain { self.isLarkVerified = true; self.isBusy = false; self.status = "Lark 验证通过"; self.appendLog(output); self.notify() }
            } catch {
                self.updateOnMain { self.isLarkVerified = false; self.isBusy = false; self.status = "Lark 验证失败，请检查应用权限"; self.appendLog(error.localizedDescription); self.notify() }
            }
        }
    }

    func authorizeLark() {
        guard !appID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { status = "请先填写 Lark App ID"; notify(); return }
        if let existing = oauthProcess {
            if existing.isRunning {
                restartOAuthWhenStopped = true
                isBusy = true
                status = "正在结束上一次授权并重新开始…"
                appendLog("收到重新授权请求：正在关闭上一次 OAuth 流程并释放本机 8788 端口。")
                notify()
                existing.terminate()
                DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 2) {
                    if existing.isRunning { existing.interrupt() }
                }
                return
            }
            oauthProcess = nil
        }
        let storedAppID = keychainValue(account: "app_id") ?? ""
        let effectiveSecret = appSecret.isEmpty && storedAppID == appID ? (keychainValue(account: "app_secret") ?? "") : appSecret
        guard effectiveSecret.count >= 8 else { status = "请填写与当前 App ID 匹配的 App Secret"; notify(); return }
        guard FileManager.default.fileExists(atPath: repoPath + "/bridge/oauth.mjs") else { status = "项目目录无效，找不到 bridge/oauth.mjs"; notify(); return }
        isBusy = true; status = "正在打开 Lark 授权页面…"; appendLog("App ID 和 App Secret 只写入 macOS 钥匙串，不写入项目文件。"); notify()
        let appID = self.appID; let appSecret = effectiveSecret
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                _ = try Self.run("/usr/bin/security", args: ["add-generic-password", "-U", "-s", keychainService, "-a", "app_id", "-w", appID])
                _ = try Self.run("/usr/bin/security", args: ["add-generic-password", "-U", "-s", keychainService, "-a", "app_secret", "-w", appSecret])
                self.startOAuthProcess()
            } catch { self.updateOnMain { self.isBusy = false; self.status = "写入钥匙串失败：\(error.localizedDescription)"; self.notify() } }
        }
    }

    func startFocus() {
        guard let focus = Int(focusMinutes), let rest = Int(restMinutes), (1...240).contains(focus), (1...240).contains(rest) else { status = "专注和休息时长必须是 1–240 分钟的整数"; notify(); return }
        guard !deviceIP.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { status = "请填写时钟 IP"; notify(); return }
        guard !hostIP.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { status = "请填写电脑 IP"; notify(); return }
        guard isAuthorized else { status = "请先完成 Lark 授权"; notify(); return }
        guard keychainValue(account: "app_id") == appID else { status = "App ID 已修改，请先重新授权 Lark"; notify(); return }
        guard FileManager.default.fileExists(atPath: repoPath + "/companion/install-macos.sh") else { status = "项目目录无效，找不到 companion/install-macos.sh"; notify(); return }
        save(); isBusy = true; status = "正在启动本机服务并连接时钟…"; appendLog("准备启动：专注 \(focus) 分钟，休息 \(rest) 分钟，设备 \(deviceIP)"); notify()
        let focusSeconds = focus * 60; let restSeconds = rest * 60; let repo = repoPath; let device = deviceIP.contains(":") ? deviceIP : deviceIP + ":5555"; let host = hostIP
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                self.updateOnMain { self.status = "1/4 检查运行环境…"; self.notify() }
                try Self.preflight(repo: repo)
                self.updateOnMain { self.isEnvironmentReady = true; self.status = "2/4 验证 Lark 系统状态…"; self.notify() }
                let node = Self.nodePath()
                let statusArgs = node == "/usr/bin/env" ? ["node", repo + "/bridge/setup-system-status.mjs"] : [repo + "/bridge/setup-system-status.mjs"]
                let lark = try Self.run(node, args: statusArgs, cwd: repo)
                self.updateOnMain { self.isLarkVerified = true; self.appendLog(lark); self.status = "3/4 安装并启动电脑助手…"; self.notify() }
                let install = try Self.run("/bin/bash", args: [repo + "/companion/install-macos.sh", "--lan-host", host, "--mode", "real", "--focus-seconds", String(focusSeconds), "--rest-seconds", String(restSeconds), "--apply"], cwd: repo)
                self.updateOnMain { self.appendLog(install); self.areServicesInstalled = true; self.areServicesRunning = true; self.status = "4/4 配置并启动 TC002…"; self.notify() }
                let configure = try Self.run("/bin/bash", args: [repo + "/companion/configure-device.sh", "--adb-target", device, "--lan-host", host, "--focus-seconds", String(focusSeconds), "--rest-seconds", String(restSeconds)], cwd: repo)
                self.updateOnMain { self.appendLog(configure); self.isDeviceReachable = true; self.notify() }
                let launch = try Self.run("/bin/bash", args: [repo + "/companion/start-focus.sh", "--adb-target", device], cwd: repo)
                self.updateOnMain { self.appendLog(launch); self.isBusy = false; self.status = "专注时钟已启动；设备重启后恢复原生界面"; self.notify() }
            } catch {
                self.updateOnMain {
                    self.isBusy = false; self.status = "启动未完成，请查看下方处理建议"
                    let message = Self.friendlyError(error.localizedDescription)
                    self.appendLog(message); self.notify()
                    if let issue = error as? EnvironmentError { self.onEnvironmentInstallOffer?(issue.brewPackages, message) }
                }
            }
        }
    }

    func stopComputerServices() {
        let labels = ["com.tc002.focus-emqx", "com.tc002.focus-bridge", "com.tc002.focus-mqtt"]; let home = FileManager.default.homeDirectoryForCurrentUser.path
        isBusy = true; notify()
        DispatchQueue.global(qos: .userInitiated).async {
            for label in labels { _ = try? Self.run("/bin/launchctl", args: ["unload", home + "/Library/LaunchAgents/\(label).plist"]) }
            self.updateOnMain { self.isBusy = false; self.areServicesRunning = false; self.status = "电脑端助手已停止；时钟仍保持当前临时界面，重启时钟即可回原生"; self.notify() }
        }
    }

    func rebootDevice() {
        let value = deviceIP.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { status = "请先填写时钟 IP"; notify(); return }
        let target = value.contains(":") ? value : value + ":5555"; isBusy = true; status = "正在重启时钟，重启后会回到原生界面…"; notify()
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
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            self?.updateOnMain { self?.appendLog(text.trimmingCharacters(in: .newlines)); self?.notify() }
        }
        process.terminationHandler = { [weak self] process in
            pipe.fileHandleForReading.readabilityHandler = nil
            let remaining = pipe.fileHandleForReading.readDataToEndOfFile()
            let remainingText = String(data: remaining, encoding: .utf8)?.trimmingCharacters(in: .newlines) ?? ""
            self?.updateOnMain {
                self?.appendLog(remainingText)
                self?.oauthProcess = nil
                let shouldRestart = self?.restartOAuthWhenStopped == true
                self?.restartOAuthWhenStopped = false
                self?.refreshAuthorizationState()
                if shouldRestart {
                    self?.isBusy = true
                    self?.isLarkVerified = false
                    self?.status = "正在重新打开 Lark 授权页面…"
                    self?.appendLog("上一次 OAuth 流程已结束，正在启动新的授权。")
                    self?.notify()
                    self?.startOAuthProcess()
                } else if process.terminationStatus == 0 {
                    self?.isBusy = false
                    self?.isLarkVerified = true; self?.appSecret = ""; self?.status = "Lark 授权和系统状态验证成功"
                    self?.notify()
                } else {
                    self?.isBusy = false
                    self?.isLarkVerified = false; self?.status = "Lark 授权未完成，请查看下方日志"
                    self?.appendLog("授权流程已退出（状态码 \(process.terminationStatus)）。可以直接点击“重新授权 Lark”再次尝试。")
                    self?.notify()
                }
            }
        }
        oauthProcess = process
        do { try process.run() } catch { pipe.fileHandleForReading.readabilityHandler = nil; oauthProcess = nil; updateOnMain { self.isBusy = false; self.status = "无法启动授权流程：\(error.localizedDescription)"; self.notify() } }
    }

    private func supportDirectory() -> URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TC002FocusCompanion", isDirectory: true) }
    private func hasKeychainValue(account: String) -> Bool { (try? Self.run("/usr/bin/security", args: ["find-generic-password", "-s", keychainService, "-a", account, "-w"])) != nil }
    private func keychainValue(account: String) -> String? { try? Self.run("/usr/bin/security", args: ["find-generic-password", "-s", keychainService, "-a", account, "-w"]).trimmingCharacters(in: .whitespacesAndNewlines) }
    private func refreshAuthorizationState() { isAuthorized = ["app_id", "app_secret", "user_open_id", "system_status_id"].allSatisfy { hasKeychainValue(account: $0) } }
    private func detectHostIP() -> String {
        var interfaces = ["en0", "en1", "en2"]
        if let listed = try? Self.run("/sbin/ifconfig", args: ["-l"]) {
            interfaces.append(contentsOf: listed.split(whereSeparator: { $0.isWhitespace }).map(String.init).filter { !$0.hasPrefix("lo") && !$0.hasPrefix("utun") && !$0.hasPrefix("awdl") && !$0.hasPrefix("llw") })
        }
        var seen = Set<String>()
        for interface in interfaces where seen.insert(interface).inserted {
            if let value = try? Self.run("/usr/sbin/ipconfig", args: ["getifaddr", interface]), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return value.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
        return ""
    }
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
        guard let node = resolvedNodePath() else { throw EnvironmentError.missingTool(name: "Node.js 24+", brewPackage: "node") }
        let nodeVersion = try run(node, args: ["--version"]).trimmingCharacters(in: .whitespacesAndNewlines)
        let nodeMajor = Int(nodeVersion.drop(while: { !$0.isNumber }).prefix(while: { $0.isNumber })) ?? 0
        guard nodeMajor >= 24 else { throw EnvironmentError.nodeTooOld(version: nodeVersion) }
        guard let adb = resolvedExecutable("adb", preferred: ["/opt/homebrew/bin/adb", "/usr/local/bin/adb", "/usr/bin/adb"]) else { throw EnvironmentError.missingTool(name: "ADB", brewPackage: "android-platform-tools") }
        _ = try run(adb, args: ["version"])
        guard let brew = resolvedExecutable("brew", preferred: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) else { throw RunnerError.failed("未找到 Homebrew；无法定位或自动安装 EMQX") }
        do { _ = try run(brew, args: ["--prefix", "emqx"]) }
        catch { throw EnvironmentError.missingTool(name: "EMQX", brewPackage: "emqx") }
        _ = try run("/bin/bash", args: [repo + "/companion/verify-runtime-bundle.sh"], cwd: repo)
    }
    private static func adbPath() -> String { resolvedExecutable("adb", preferred: ["/opt/homebrew/bin/adb", "/usr/local/bin/adb", "/usr/bin/adb"]) ?? "/usr/bin/env" }
    private static func nodePath() -> String { resolvedNodePath() ?? "/usr/bin/env" }
    private static func resolvedNodePath() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var candidates = [
            "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node",
            home + "/.local/bin/node", home + "/.volta/bin/node", home + "/.local/share/mise/shims/node"
        ]
        let roots = [home + "/.local/node", home + "/.nvm/versions/node"]
        for root in roots {
            if let entries = try? FileManager.default.contentsOfDirectory(atPath: root) {
                candidates.append(contentsOf: entries.sorted().reversed().map { root + "/" + $0 + "/bin/node" })
            }
        }
        let fnmRoot = home + "/Library/Application Support/fnm/node-versions"
        if let entries = try? FileManager.default.contentsOfDirectory(atPath: fnmRoot) {
            candidates.append(contentsOf: entries.sorted().reversed().map { fnmRoot + "/" + $0 + "/installation/bin/node" })
        }
        return resolvedExecutable("node", preferred: candidates)
    }
    private static func resolvedExecutable(_ name: String, preferred: [String]) -> String? {
        var candidates = preferred
        let environmentPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
        candidates.append(contentsOf: environmentPath.split(separator: ":").map { String($0) + "/" + name })
        var seen = Set<String>()
        return candidates.first { seen.insert($0).inserted && FileManager.default.isExecutableFile(atPath: $0) }
    }
    private static func toolPath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let paths = [resolvedNodePath().map { URL(fileURLWithPath: $0).deletingLastPathComponent().path }, home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].compactMap { $0 }
        let uniquePaths = NSOrderedSet(array: paths).array.compactMap { $0 as? String }
        return uniquePaths.joined(separator: ":")
    }
    private static func friendlyError(_ message: String) -> String {
        if message.contains("找不到 EMQX") || message.contains("brew --prefix emqx") { return "EMQX 未安装。请先运行一键准备，或执行 brew install emqx。\n\(message)" }
        if message.contains("ADB") || message.contains("adb") { return "无法连接 TC002。请确认时钟已开启 Wi-Fi ADB，且与 Mac 在同一局域网。\n\(message)" }
        if message.contains("system status") || message.contains("Lark") || message.contains("钥匙串") { return "Lark 配置不完整。请确认自建应用已开通系统状态权限，然后重新授权。\n\(message)" }
        return message
    }
}

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = AppModel(); private var window: NSWindow!
    private let deviceField = NSTextField(); private let hostField = NSTextField(); private let focusField = NSTextField(); private let restField = NSTextField(); private let appIDField = NSTextField(); private let appSecretField = NSSecureTextField(); private let repoField = NSTextField(); private let statusField = NSTextField(labelWithString: ""); private let logView = NSTextView()
    private let startButton = NSButton(title: "启动专注时钟", target: nil, action: nil); private let stopButton = NSButton(title: "停止电脑助手", target: nil, action: nil); private let rebootButton = NSButton(title: "恢复原生界面（重启时钟）", target: nil, action: nil); private let authorizeButton = NSButton(title: "授权 Lark", target: nil, action: nil)
    private let environmentButton = NSButton(title: "检查运行环境", target: nil, action: nil); private let deviceButton = NSButton(title: "测试时钟连接", target: nil, action: nil); private let verifyLarkButton = NSButton(title: "验证 Lark 配置", target: nil, action: nil)
    private let advancedButton = NSButton(title: "显示高级设置", target: nil, action: nil)
    private let busyIndicator = NSProgressIndicator()
    private let operationIcon = NSImageView()
    private var advancedSection: NSBox?
    private var readinessLabels: [NSTextField] = []
    private var readinessIcons: [NSImageView] = []
    private var readinessCards: [NSBox] = []

    static func main() { let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate; app.setActivationPolicy(.regular); withExtendedLifetime(delegate) { app.run() } }
    func applicationDidFinishLaunching(_ notification: Notification) { model.onChange = { [weak self] in self?.refresh() }; model.onEnvironmentInstallOffer = { [weak self] packages, message in self?.offerEnvironmentInstall(packages: packages, reason: message) }; buildWindow(); model.load(); populateFieldsFromModel(); refresh(); model.autoValidateSavedConfiguration() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { collectFields(); model.save() }

    private func buildWindow() {
        let backdrop = NSVisualEffectView()
        backdrop.material = .underWindowBackground
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 800, height: 1580))
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.documentView = content
        scroll.translatesAutoresizingMaskIntoConstraints = false
        backdrop.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: backdrop.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: backdrop.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: backdrop.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: backdrop.bottomAnchor)
        ])

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 28),
            stack.widthAnchor.constraint(equalToConstant: 736)
        ])

        stack.addArrangedSubview(hero())
        let statusHeading = NSTextField(labelWithString: "系统状态")
        statusHeading.font = .systemFont(ofSize: 14, weight: .semibold)
        statusHeading.textColor = .secondaryLabelColor
        stack.addArrangedSubview(statusHeading)
        let readinessRow = NSStackView(views: [
            readinessChip("运行环境", symbol: "shippingbox.fill"),
            readinessChip("Lark", symbol: "checkmark.seal.fill"),
            readinessChip("TC002", symbol: "display.2"),
            readinessChip("电脑助手", symbol: "bolt.horizontal.circle.fill")
        ])
        readinessRow.orientation = .horizontal
        readinessRow.spacing = 10
        readinessRow.distribution = .fillEqually
        readinessRow.widthAnchor.constraint(equalToConstant: 736).isActive = true
        readinessRow.heightAnchor.constraint(equalToConstant: 62).isActive = true
        stack.addArrangedSubview(readinessRow)

        authorizeButton.target = self; authorizeButton.action = #selector(authorize)
        styleButton(authorizeButton, symbol: "person.badge.key.fill")
        environmentButton.target = self; environmentButton.action = #selector(checkEnvironment)
        styleButton(environmentButton, symbol: "checkmark.shield.fill")
        stack.addArrangedSubview(section("准备电脑", step: "01", symbol: "desktopcomputer", accent: .systemBlue, height: 136, rows: [hint("检查 Node.js、ADB、EMQX 和已校验的 TC002 运行包。"), buttonRow(environmentButton)]))

        deviceButton.target = self; deviceButton.action = #selector(checkDevice)
        styleButton(deviceButton, symbol: "antenna.radiowaves.left.and.right")
        stack.addArrangedSubview(section("连接 TC002", step: "02", symbol: "display.2", accent: .systemTeal, height: 176, rows: [row("时钟 IP", deviceField, "例如 192.168.1.131"), rowWithButton("电脑 IP", hostField, "局域网 IPv4", "自动识别", #selector(detectHost)), buttonRow(deviceButton)]))

        verifyLarkButton.target = self; verifyLarkButton.action = #selector(verifyLark)
        styleButton(verifyLarkButton, symbol: "checkmark.seal.fill")
        stack.addArrangedSubview(section("授权 Lark", step: "03", symbol: "person.crop.circle.badge.checkmark", accent: .systemIndigo, height: 184, rows: [row("App ID", appIDField, "Lark 自建应用 App ID"), row("App Secret", appSecretField, "只写入 macOS 钥匙串"), buttonGroup([authorizeButton, verifyLarkButton])]))

        stack.addArrangedSubview(section("专注节奏", step: "04", symbol: "timer", accent: .systemGreen, height: 146, rows: [row("专注（分钟）", focusField, "45"), row("休息（分钟）", restField, "5")]))
        advancedButton.target = self
        advancedButton.action = #selector(toggleAdvanced)
        advancedButton.bezelStyle = .inline
        advancedButton.controlSize = .small
        advancedButton.font = .systemFont(ofSize: 12, weight: .medium)
        advancedButton.image = symbol("chevron.right", size: 10, weight: .semibold)
        advancedButton.imagePosition = .imageLeading
        advancedButton.contentTintColor = .secondaryLabelColor
        advancedButton.toolTip = "仅在使用自定义源码目录时需要修改"
        stack.addArrangedSubview(advancedButton)
        let advanced = section("高级设置", step: "", symbol: "gearshape.fill", accent: .secondaryLabelColor, height: 108, rows: [row("项目目录", repoField, "通常无需修改")])
        advanced.isHidden = true
        advancedSection = advanced
        stack.addArrangedSubview(advanced)

        startButton.target = self; startButton.action = #selector(startFocus); startButton.keyEquivalent = "\r"
        stopButton.target = self; stopButton.action = #selector(stopServices)
        rebootButton.target = self; rebootButton.action = #selector(reboot)
        styleButton(startButton, symbol: "play.fill", primary: true)
        styleButton(stopButton, symbol: "stop.circle.fill")
        styleButton(rebootButton, symbol: "arrow.counterclockwise.circle.fill")
        rebootButton.contentTintColor = .systemRed
        startButton.toolTip = "验证配置并启动本机服务与 TC002 临时界面"
        stopButton.toolTip = "停止 Mac 上的 EMQX、Lark bridge 和 MQTT adapter"
        rebootButton.toolTip = "重启 TC002 并恢复设备原生界面"
        let actions = NSStackView(views: [startButton, stopButton, rebootButton])
        actions.orientation = .horizontal
        actions.spacing = 12
        actions.distribution = .fillEqually
        actions.widthAnchor.constraint(equalToConstant: 736).isActive = true
        actions.heightAnchor.constraint(equalToConstant: 44).isActive = true
        stack.addArrangedSubview(actions)

        stack.addArrangedSubview(operationCard())
        stack.addArrangedSubview(logCard())

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 840), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "TC002 Focus Clock"
        window.titlebarAppearsTransparent = false
        window.minSize = NSSize(width: 800, height: 680)
        window.contentView = backdrop
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func hero() -> NSView {
        let box = card()
        box.widthAnchor.constraint(equalToConstant: 736).isActive = true
        box.heightAnchor.constraint(equalToConstant: 132).isActive = true

        let icon = NSImageView(image: symbol("timer", size: 36, weight: .semibold))
        icon.contentTintColor = .systemGreen
        icon.widthAnchor.constraint(equalToConstant: 48).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 48).isActive = true

        let title = NSTextField(labelWithString: "TC002 Focus Clock")
        title.font = .systemFont(ofSize: 28, weight: .bold)
        title.heightAnchor.constraint(greaterThanOrEqualToConstant: 36).isActive = true
        let subtitle = NSTextField(labelWithString: "专注更清晰，状态自然同步")
        subtitle.font = .systemFont(ofSize: 14, weight: .medium)
        subtitle.textColor = .secondaryLabelColor
        subtitle.heightAnchor.constraint(greaterThanOrEqualToConstant: 20).isActive = true
        let badge = NSTextField(labelWithString: "  临时部署 · 不刷固件  ")
        badge.font = .systemFont(ofSize: 11, weight: .semibold)
        badge.textColor = .systemGreen
        badge.wantsLayer = true
        badge.layer?.cornerRadius = 8
        badge.layer?.backgroundColor = NSColor.systemGreen.withAlphaComponent(0.10).cgColor
        badge.heightAnchor.constraint(equalToConstant: 22).isActive = true
        let copy = NSStackView(views: [title, subtitle, badge])
        copy.orientation = .vertical
        copy.alignment = .leading
        copy.spacing = 5

        let digits = NSTextField(labelWithString: "45:00")
        digits.font = .monospacedDigitSystemFont(ofSize: 27, weight: .bold)
        digits.textColor = NSColor(calibratedRed: 0.18, green: 0.90, blue: 0.46, alpha: 1)
        digits.alignment = .center
        let mode = NSTextField(labelWithString: "FOCUS  ●")
        mode.font = .monospacedSystemFont(ofSize: 9, weight: .semibold)
        mode.textColor = NSColor(calibratedRed: 0.18, green: 0.90, blue: 0.46, alpha: 0.85)
        mode.alignment = .center
        let displayStack = NSStackView(views: [digits, mode])
        displayStack.orientation = .vertical
        displayStack.alignment = .centerX
        displayStack.spacing = 0
        displayStack.wantsLayer = true
        displayStack.layer?.backgroundColor = NSColor(calibratedWhite: 0.035, alpha: 1).cgColor
        displayStack.layer?.cornerRadius = 12
        displayStack.layer?.borderWidth = 1
        displayStack.layer?.borderColor = NSColor.white.withAlphaComponent(0.08).cgColor
        displayStack.widthAnchor.constraint(equalToConstant: 170).isActive = true
        displayStack.heightAnchor.constraint(equalToConstant: 66).isActive = true

        let row = NSStackView(views: [icon, copy, NSView(), displayStack])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 16
        row.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 20),
            row.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -20),
            row.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 16),
            row.bottomAnchor.constraint(equalTo: box.contentView!.bottomAnchor, constant: -16)
        ])
        return box
    }

    private func section(_ title: String, step: String, symbol symbolName: String, accent: NSColor, height: CGFloat, rows: [NSView]) -> NSBox {
        let box = card()
        let icon = NSImageView(image: symbol(symbolName, size: 16, weight: .semibold))
        icon.contentTintColor = accent
        icon.widthAnchor.constraint(equalToConstant: 22).isActive = true
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 16, weight: .semibold)
        heading.usesSingleLineMode = true
        heading.lineBreakMode = .byClipping
        heading.setContentHuggingPriority(.required, for: .horizontal)
        heading.setContentCompressionResistancePriority(.required, for: .horizontal)
        heading.heightAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
        let badge = NSTextField(labelWithString: step)
        badge.font = .monospacedDigitSystemFont(ofSize: 11, weight: .bold)
        badge.textColor = accent
        badge.alignment = .right
        badge.setContentCompressionResistancePriority(.required, for: .horizontal)
        badge.widthAnchor.constraint(equalToConstant: 24).isActive = true
        let header = NSStackView(views: [icon, heading, NSView(), badge])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 8
        header.heightAnchor.constraint(greaterThanOrEqualToConstant: 26).isActive = true

        let rowsStack = NSStackView(views: rows)
        rowsStack.orientation = .vertical
        rowsStack.alignment = .leading
        rowsStack.spacing = 10
        let inner = NSStackView(views: [header, rowsStack])
        inner.orientation = .vertical
        inner.alignment = .leading
        inner.spacing = 12
        inner.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(inner)
        NSLayoutConstraint.activate([
            inner.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 18),
            inner.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -18),
            inner.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 14),
            inner.bottomAnchor.constraint(lessThanOrEqualTo: box.contentView!.bottomAnchor, constant: -14),
            header.widthAnchor.constraint(equalTo: inner.widthAnchor),
            rowsStack.widthAnchor.constraint(equalTo: inner.widthAnchor)
        ])
        box.widthAnchor.constraint(equalToConstant: 736).isActive = true
        box.heightAnchor.constraint(equalToConstant: height).isActive = true
        return box
    }

    private func card() -> NSBox {
        let box = NSBox()
        box.boxType = .custom
        box.titlePosition = .noTitle
        box.cornerRadius = 14
        box.borderWidth = 1
        box.borderColor = NSColor.separatorColor.withAlphaComponent(0.45)
        box.fillColor = NSColor.controlBackgroundColor.withAlphaComponent(0.80)
        return box
    }

    private func readinessChip(_ title: String, symbol symbolName: String) -> NSBox {
        let box = card()
        box.cornerRadius = 11
        let icon = NSImageView(image: symbol(symbolName, size: 15, weight: .semibold))
        icon.contentTintColor = .tertiaryLabelColor
        icon.widthAnchor.constraint(equalToConstant: 20).isActive = true
        let value = NSTextField(labelWithString: title)
        value.font = .systemFont(ofSize: 12, weight: .semibold)
        value.textColor = .secondaryLabelColor
        value.lineBreakMode = .byTruncatingTail
        let row = NSStackView(views: [icon, value])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 6
        row.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(lessThanOrEqualTo: box.contentView!.trailingAnchor, constant: -10),
            row.centerYAnchor.constraint(equalTo: box.contentView!.centerYAnchor)
        ])
        readinessCards.append(box); readinessIcons.append(icon); readinessLabels.append(value)
        return box
    }

    private func operationCard() -> NSBox {
        let box = card()
        box.widthAnchor.constraint(equalToConstant: 736).isActive = true
        box.heightAnchor.constraint(equalToConstant: 84).isActive = true
        operationIcon.image = symbol("info.circle.fill", size: 20, weight: .semibold)
        operationIcon.contentTintColor = .systemBlue
        operationIcon.widthAnchor.constraint(equalToConstant: 28).isActive = true
        statusField.maximumNumberOfLines = 2
        statusField.lineBreakMode = .byWordWrapping
        statusField.font = .systemFont(ofSize: 14, weight: .medium)
        busyIndicator.style = .spinning
        busyIndicator.controlSize = .small
        busyIndicator.isDisplayedWhenStopped = false
        let row = NSStackView(views: [operationIcon, statusField, NSView(), busyIndicator])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        row.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 18),
            row.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -18),
            row.centerYAnchor.constraint(equalTo: box.contentView!.centerYAnchor)
        ])
        return box
    }

    private func logCard() -> NSBox {
        let box = card()
        box.widthAnchor.constraint(equalToConstant: 736).isActive = true
        box.heightAnchor.constraint(equalToConstant: 246).isActive = true
        let title = NSTextField(labelWithString: "运行日志")
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        title.usesSingleLineMode = true
        title.setContentHuggingPriority(.required, for: .horizontal)
        title.setContentCompressionResistancePriority(.required, for: .horizontal)
        title.heightAnchor.constraint(greaterThanOrEqualToConstant: 22).isActive = true
        let detail = NSTextField(labelWithString: "  不记录凭据  ")
        detail.font = .systemFont(ofSize: 10, weight: .medium)
        detail.textColor = .secondaryLabelColor
        detail.alignment = .center
        detail.wantsLayer = true
        detail.layer?.cornerRadius = 7
        detail.layer?.backgroundColor = NSColor.secondaryLabelColor.withAlphaComponent(0.08).cgColor
        detail.setContentHuggingPriority(.required, for: .horizontal)
        detail.setContentCompressionResistancePriority(.required, for: .horizontal)
        detail.heightAnchor.constraint(equalToConstant: 20).isActive = true
        let clear = NSButton(title: "清空", target: self, action: #selector(clearLog))
        clear.bezelStyle = .inline
        clear.controlSize = .small
        let header = NSStackView(views: [title, NSView(), detail, clear])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 10
        header.heightAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
        logView.isEditable = false
        logView.isRichText = false
        logView.isSelectable = true
        logView.isVerticallyResizable = true
        logView.isHorizontallyResizable = false
        logView.autoresizingMask = [.width]
        logView.frame = NSRect(x: 0, y: 0, width: 704, height: 184)
        logView.minSize = NSSize(width: 0, height: 184)
        logView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        logView.font = .systemFont(ofSize: 13, weight: .regular)
        logView.textColor = .labelColor
        logView.backgroundColor = NSColor.textBackgroundColor.withAlphaComponent(0.55)
        logView.textContainerInset = NSSize(width: 14, height: 12)
        logView.textContainer?.lineFragmentPadding = 2
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 3
        paragraphStyle.paragraphSpacing = 2
        logView.defaultParagraphStyle = paragraphStyle
        logView.textContainer?.widthTracksTextView = true
        logView.textContainer?.containerSize = NSSize(width: 704, height: CGFloat.greatestFiniteMagnitude)
        let logScroll = NSScrollView()
        logScroll.drawsBackground = false
        logScroll.borderType = .noBorder
        logScroll.hasVerticalScroller = true
        logScroll.autohidesScrollers = true
        logScroll.documentView = logView
        logScroll.wantsLayer = true
        logScroll.layer?.cornerRadius = 9
        logScroll.layer?.masksToBounds = true
        let inner = NSStackView(views: [header, logScroll])
        inner.orientation = .vertical
        inner.alignment = .leading
        inner.spacing = 10
        inner.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(inner)
        NSLayoutConstraint.activate([
            inner.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 16),
            inner.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -16),
            inner.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 14),
            inner.bottomAnchor.constraint(equalTo: box.contentView!.bottomAnchor, constant: -14),
            header.widthAnchor.constraint(equalTo: inner.widthAnchor),
            logScroll.widthAnchor.constraint(equalTo: inner.widthAnchor),
            logScroll.heightAnchor.constraint(equalToConstant: 184)
        ])
        return box
    }

    private func row(_ title: String, _ field: NSTextField, _ placeholder: String) -> NSView {
        configureField(field, placeholder: placeholder, width: 520)
        return rowLabel(title, field)
    }
    private func rowWithButton(_ title: String, _ field: NSTextField, _ placeholder: String, _ buttonTitle: String, _ action: Selector) -> NSView {
        let row = NSStackView(); row.orientation = .horizontal; row.spacing = 10
        configureField(field, placeholder: placeholder, width: 398)
        let button = NSButton(title: buttonTitle, target: self, action: action)
        button.bezelStyle = .rounded; button.controlSize = .large
        button.image = symbol("location.fill", size: 12, weight: .medium)
        button.imagePosition = .imageLeading
        button.widthAnchor.constraint(equalToConstant: 112).isActive = true
        row.addArrangedSubview(label(title)); row.addArrangedSubview(field); row.addArrangedSubview(button)
        return row
    }
    private func configureField(_ field: NSTextField, placeholder: String, width: CGFloat) {
        field.placeholderString = placeholder
        field.bezelStyle = .roundedBezel
        field.controlSize = .large
        field.font = .systemFont(ofSize: 13)
        field.widthAnchor.constraint(equalToConstant: width).isActive = true
        field.heightAnchor.constraint(equalToConstant: 30).isActive = true
    }
    private func rowLabel(_ title: String, _ view: NSView) -> NSView { let row = NSStackView(views: [label(title), view]); row.orientation = .horizontal; row.alignment = .centerY; row.spacing = 10; return row }
    private func label(_ text: String) -> NSTextField { let field = NSTextField(labelWithString: text); field.font = .systemFont(ofSize: 13, weight: .medium); field.textColor = .secondaryLabelColor; field.widthAnchor.constraint(equalToConstant: 142).isActive = true; field.heightAnchor.constraint(equalToConstant: 30).isActive = true; return field }
    private func buttonRow(_ button: NSButton) -> NSView { button }
    private func buttonGroup(_ buttons: [NSButton]) -> NSView { let row = NSStackView(views: buttons); row.orientation = .horizontal; row.spacing = 10; return row }
    private func hint(_ text: String) -> NSView { let value = NSTextField(labelWithString: text); value.textColor = .secondaryLabelColor; value.font = .systemFont(ofSize: 13); value.maximumNumberOfLines = 0; value.widthAnchor.constraint(equalToConstant: 680).isActive = true; return value }
    private func styleButton(_ button: NSButton, symbol symbolName: String, primary: Bool = false) {
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.font = .systemFont(ofSize: 13, weight: primary ? .semibold : .medium)
        button.image = symbol(symbolName, size: 13, weight: .semibold)
        button.imagePosition = .imageLeading
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: primary ? 40 : 34).isActive = true
        if primary { button.bezelColor = .systemGreen; button.contentTintColor = .systemGreen }
    }
    private func symbol(_ name: String, size: CGFloat, weight: NSFont.Weight) -> NSImage {
        let configuration = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
        return (NSImage(systemSymbolName: name, accessibilityDescription: nil) ?? NSImage()).withSymbolConfiguration(configuration) ?? NSImage()
    }
    private func collectFields() { model.deviceIP = deviceField.stringValue; model.hostIP = hostField.stringValue; model.focusMinutes = focusField.stringValue; model.restMinutes = restField.stringValue; model.appID = appIDField.stringValue; model.appSecret = appSecretField.stringValue; model.repoPath = repoField.stringValue }
    private func populateFieldsFromModel() { deviceField.stringValue = model.deviceIP; hostField.stringValue = model.hostIP; focusField.stringValue = model.focusMinutes; restField.stringValue = model.restMinutes; appIDField.stringValue = model.appID; repoField.stringValue = model.repoPath }
    private func updateReadiness(_ index: Int, title: String, ready: Bool, partial: Bool = false) {
        guard readinessLabels.indices.contains(index) else { return }
        let color: NSColor = ready ? .systemGreen : (partial ? .systemOrange : .tertiaryLabelColor)
        readinessLabels[index].stringValue = title
        readinessLabels[index].textColor = ready || partial ? color : .secondaryLabelColor
        readinessIcons[index].contentTintColor = color
        readinessCards[index].fillColor = color.withAlphaComponent(ready || partial ? 0.09 : 0.025)
        readinessCards[index].borderColor = color.withAlphaComponent(ready || partial ? 0.35 : 0.18)
    }
    private func refresh() {
        DispatchQueue.main.async {
            self.statusField.stringValue = self.model.status
            self.logView.string = self.model.logText
            let paragraphStyle = NSMutableParagraphStyle()
            paragraphStyle.lineSpacing = 3
            paragraphStyle.paragraphSpacing = 2
            let logRange = NSRange(location: 0, length: self.logView.string.utf16.count)
            self.logView.textStorage?.setAttributes([
                .font: NSFont.systemFont(ofSize: 13, weight: .regular),
                .foregroundColor: NSColor.labelColor,
                .paragraphStyle: paragraphStyle
            ], range: logRange)
            if let container = self.logView.textContainer { self.logView.layoutManager?.ensureLayout(for: container) }
            self.logView.needsDisplay = true
            self.logView.scrollToEndOfDocument(nil)
            self.updateReadiness(0, title: self.model.isEnvironmentReady ? "环境就绪" : "待检查环境", ready: self.model.isEnvironmentReady)
            self.updateReadiness(1, title: self.model.isLarkVerified ? "Lark 已验证" : (self.model.isAuthorized ? "Lark 待验证" : "待授权 Lark"), ready: self.model.isLarkVerified, partial: self.model.isAuthorized)
            self.updateReadiness(2, title: self.model.isDeviceReachable ? "TC002 已连接" : "待连接 TC002", ready: self.model.isDeviceReachable)
            let serviceTitle = self.model.areServicesRunning ? "助手运行中" : (self.model.isReadyToStart ? "可以启动" : (self.model.areServicesInstalled ? "助手已停止" : "待首次启动"))
            self.updateReadiness(3, title: serviceTitle, ready: self.model.areServicesRunning || self.model.isReadyToStart, partial: self.model.areServicesInstalled)
            self.operationIcon.image = self.symbol(self.model.isBusy ? "clock.arrow.circlepath" : (self.model.status.contains("失败") || self.model.status.contains("未通过") || self.model.status.contains("未完成") ? "exclamationmark.triangle.fill" : "info.circle.fill"), size: 20, weight: .semibold)
            self.operationIcon.contentTintColor = self.model.isBusy ? .systemBlue : (self.model.status.contains("失败") || self.model.status.contains("未通过") || self.model.status.contains("未完成") ? .systemOrange : .systemGreen)
            if self.model.isBusy { self.busyIndicator.startAnimation(nil) } else { self.busyIndicator.stopAnimation(nil) }
            self.authorizeButton.title = self.model.isOAuthRunning ? "重新开始授权" : (self.model.isAuthorized ? "重新授权 Lark" : "授权 Lark")
            self.authorizeButton.isEnabled = !self.model.isBusy || self.model.isOAuthRunning
            self.environmentButton.isEnabled = !self.model.isBusy
            self.deviceButton.isEnabled = !self.model.isBusy
            self.verifyLarkButton.isEnabled = !self.model.isBusy && self.model.isAuthorized
            self.startButton.isEnabled = !self.model.isBusy && self.model.isAuthorized
            self.stopButton.isEnabled = !self.model.isBusy && self.model.areServicesRunning
            self.rebootButton.isEnabled = !self.model.isBusy
            if self.model.appSecret.isEmpty && self.model.isAuthorized && !self.model.isBusy { self.appSecretField.stringValue = "" }
        }
    }
    @objc private func detectHost() { collectFields(); model.detectHost(); hostField.stringValue = model.hostIP }
    @objc private func checkEnvironment() { collectFields(); model.checkEnvironment() }
    @objc private func checkDevice() { collectFields(); model.checkDevice() }
    @objc private func verifyLark() { collectFields(); model.verifyLark() }
    @objc private func authorize() { collectFields(); model.authorizeLark() }
    @objc private func toggleAdvanced() {
        guard let advancedSection else { return }
        advancedSection.isHidden.toggle()
        let isVisible = !advancedSection.isHidden
        advancedButton.title = isVisible ? "隐藏高级设置" : "显示高级设置"
        advancedButton.image = symbol(isVisible ? "chevron.down" : "chevron.right", size: 10, weight: .semibold)
    }
    @objc private func startFocus() { collectFields(); model.startFocus() }
    @objc private func stopServices() { model.stopComputerServices() }
    @objc private func clearLog() { model.logText = ""; model.onChange?() }
    @objc private func reboot() { let alert = NSAlert(); alert.messageText = "确认重启时钟？"; alert.informativeText = "重启只会让临时程序消失，不会刷写固件。"; alert.addButton(withTitle: "重启"); alert.addButton(withTitle: "取消"); if alert.runModal() == .alertFirstButtonReturn { collectFields(); model.rebootDevice() } }
    private func offerEnvironmentInstall(packages: [String], reason: String) {
        let displayNames = packages.map { $0 == "node" ? "Node.js 24+" : ($0 == "android-platform-tools" ? "ADB" : $0.uppercased()) }
        let alert = NSAlert(); alert.alertStyle = .warning; alert.messageText = "缺少运行组件"
        alert.informativeText = "\(reason)\n\n是否使用 Homebrew 安装：\(displayNames.joined(separator: "、"))？"
        alert.addButton(withTitle: "安装"); alert.addButton(withTitle: "暂不安装")
        if alert.runModal() == .alertFirstButtonReturn { model.installEnvironment(packages: packages) }
    }
}
