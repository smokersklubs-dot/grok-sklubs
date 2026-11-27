import ActivityKit
import ExpoModulesCore

/*
 * L177 — Live Activity of a bot's running task (iPhone, iOS 16.4+, the app's deployment target).
 * Not compiled nor run here (no Mac): written from Apple's ActivityKit documentation and Expo's module API:
 * - https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
 * - https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
 *   (Activity.request(attributes:content:pushType: .token), pushTokenUpdates, hex token sent to the server)
 * - https://docs.expo.dev/modules/module-api/ (Name, Function, AsyncFunction, Events, sendEvent, Record / @Field)
 *
 * SklubotTaskAttributes is declared twice on purpose, here and in targets/sklubot-live/SklubotTaskAttributes.swift: the
 * app (this pod) and the widget extension are separate binaries, and ActivityKit hands the attributes and content state
 * across as Codable data of the type with that name. Keep both copies identical (and ContentState equal to
 * TaskActivityState in server/src/clientshared/taskactivity.ts).
 */
struct SklubotTaskAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var step: String
    var steps: Int
    /// Seconds since 1970 (not a Date: the server's JSON is decoded with the default strategies).
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

struct StartAttributes: Record {
  @Field var botId: String = ""
  @Field var botName: String = ""
  @Field var thread: Int = 0
  @Field var stopUrl: String = ""
  @Field var stopLabel: String = ""
  @Field var runningLabel: String = ""
  @Field var waitingLabel: String = ""
}

struct StateRecord: Record {
  @Field var step: String = ""
  @Field var steps: Int = 0
  @Field var startedAt: Double = 0
  @Field var awaiting: Bool = false

  func toState() -> SklubotTaskAttributes.ContentState {
    SklubotTaskAttributes.ContentState(step: step, steps: steps, startedAt: startedAt, awaiting: awaiting)
  }
}

public class SklubotLiveActivityModule: Module {
  private func find(_ id: String) -> Activity<SklubotTaskAttributes>? {
    Activity<SklubotTaskAttributes>.activities.first { $0.id == id }
  }

  public func definition() -> ModuleDefinition {
    Name("SklubotLiveActivity")
    Events("onPushToken")

    /// The person allowed Live Activities for the app (Settings → Sklubot → Live Activities).
    Function("areEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// The Live Activities still on screen (after the app was closed and opened again).
    Function("list") { () -> [[String: Any]] in
      Activity<SklubotTaskAttributes>.activities.map { ["id": $0.id, "botId": $0.attributes.botId, "thread": $0.attributes.thread] }
    }

    /// Starts one; its push token arrives later through the "onPushToken" event (and again whenever it changes).
    AsyncFunction("start") { (attrs: StartAttributes, state: StateRecord, withPush: Bool) throws -> String in
      let attributes = SklubotTaskAttributes(
        botId: attrs.botId, botName: attrs.botName, thread: attrs.thread, stopUrl: attrs.stopUrl,
        stopLabel: attrs.stopLabel, runningLabel: attrs.runningLabel, waitingLabel: attrs.waitingLabel)
      let content = ActivityContent(state: state.toState(), staleDate: nil)
      let activity = try Activity.request(attributes: attributes, content: content, pushType: withPush ? .token : nil)
      if withPush {
        Task { [weak self] in
          for await data in activity.pushTokenUpdates {
            let hex = data.map { String(format: "%02x", $0) }.joined()
            self?.sendEvent("onPushToken", ["id": activity.id, "botId": attrs.botId, "thread": attrs.thread, "token": hex])
          }
        }
      }
      return activity.id
    }

    AsyncFunction("update") { (id: String, state: StateRecord) async -> Bool in
      guard let activity = self.find(id) else { return false }
      await activity.update(ActivityContent(state: state.toState(), staleDate: nil))
      return true
    }

    /// Ends it with its last state; it leaves the Lock Screen after ten minutes.
    AsyncFunction("end") { (id: String, state: StateRecord) async -> Bool in
      guard let activity = self.find(id) else { return false }
      await activity.end(ActivityContent(state: state.toState(), staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(600)))
      return true
    }
  }
}
