import ActivityKit
import Foundation

/*
 * Twin of the struct in modules/sklubot-liveactivity/ios/SklubotLiveActivityModule.swift (see the note there): same
 * name, same fields, same types. ContentState = TaskActivityState in server/src/clientshared/taskactivity.ts.
 */
struct SklubotTaskAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var step: String
    var steps: Int
    /// Seconds since 1970.
    var startedAt: Double
    var awaiting: Bool
  }

  var botId: String
  var botName: String
  var thread: Int
  var stopUrl: String
  var stopLabel: String
  var runningLabel: String
  var waitingLabel: String
}
