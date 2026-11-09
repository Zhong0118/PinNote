// usage: winid <pid>... → "windowid alpha layer width height onscreen" for each window of those pids
import CoreGraphics
import Foundation
let pids = Set(CommandLine.arguments.dropFirst().compactMap { Int32($0) })
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list {
  guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pids.contains(pid) else { continue }
  let b = w[kCGWindowBounds as String] as! [String: CGFloat]
  print(w[kCGWindowNumber as String]!, w[kCGWindowAlpha as String]!, w[kCGWindowLayer as String]!, Int(b["Width"]!), Int(b["Height"]!), (w[kCGWindowIsOnscreen as String] as? Bool) ?? false)
}
