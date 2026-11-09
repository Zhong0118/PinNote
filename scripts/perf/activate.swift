import AppKit
if let pid = Int32(CommandLine.arguments[1]), let app = NSRunningApplication(processIdentifier: pid) { app.activate() }
