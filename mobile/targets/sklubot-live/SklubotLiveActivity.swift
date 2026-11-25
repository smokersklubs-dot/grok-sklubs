import ActivityKit
import SwiftUI
import WidgetKit

/*
 * L177 — what the Live Activity shows: the bot's name, the current step (or what it waits for), the elapsed time and a
 * « Stop » link that opens the app, which asks before stopping (sklubot://stop/<bot>?thread=<n>, App.tsx).
 * Written from Apple's documentation, not compiled here (no Mac) and not seen on a device:
 * - ActivityConfiguration / DynamicIsland regions:
 *   https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
 * - Link and widgetURL in a Live Activity (a tap opens the app at that URL): same page, "Add deep links".
 * - Text(_:style: .timer) counts up from a past date: https://developer.apple.com/documentation/swiftui/text/datestyle/timer
 * All words come from the app (attributes, already in the person's language): nothing to translate here.
 */
@main
struct SklubotLiveBundle: WidgetBundle {
  var body: some Widget {
    SklubotTaskLiveActivity()
  }
}

private let brand = Color(red: 0xe2 / 255, green: 0x55 / 255, blue: 0x2d / 255)
private let waitColor = Color(red: 0xc2 / 255, green: 0x7c / 255, blue: 0x0e / 255)

private func started(_ s: SklubotTaskAttributes.ContentState) -> Date { Date(timeIntervalSince1970: s.startedAt) }
private func stepText(_ c: ActivityViewContext<SklubotTaskAttributes>) -> String {
  if !c.state.step.isEmpty { return c.state.step }
  return c.state.awaiting ? c.attributes.waitingLabel : c.attributes.runningLabel
}

struct StopLink: View {
  let context: ActivityViewContext<SklubotTaskAttributes>
  var body: some View {
    if let url = URL(string: context.attributes.stopUrl) {
      Link(destination: url) {
        Label(context.attributes.stopLabel, systemImage: "stop.fill")
          .font(.footnote.weight(.semibold))
          .padding(.horizontal, 12).padding(.vertical, 6)
          .background(Capsule().fill(brand.opacity(0.18)))
          .foregroundColor(brand)
      }
      .accessibilityLabel(Text("\(context.attributes.stopLabel) — \(context.attributes.botName)"))
    }
  }
}

struct LockScreenView: View {
  let context: ActivityViewContext<SklubotTaskAttributes>
  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Image(systemName: context.state.awaiting ? "hand.raised.fill" : "sparkles")
        .foregroundColor(context.state.awaiting ? waitColor : brand)
        .font(.title2)
      VStack(alignment: .leading, spacing: 2) {
        Text(context.attributes.botName).font(.headline).lineLimit(1)
        Text(stepText(context)).font(.subheadline).foregroundColor(.secondary).lineLimit(2)
        HStack(spacing: 6) {
          Text(started(context.state), style: .timer).font(.caption.monospacedDigit())
          if context.state.steps > 0 { Text("· \(context.state.steps)").font(.caption).foregroundColor(.secondary) }
        }
      }
      Spacer(minLength: 8)
      StopLink(context: context)
    }
    .padding(14)
  }
}

struct SklubotTaskLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SklubotTaskAttributes.self) { context in
      LockScreenView(context: context)
        .widgetURL(URL(string: "sklubot://bot/\(context.attributes.botId)"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.attributes.botName, systemImage: context.state.awaiting ? "hand.raised.fill" : "sparkles")
            .font(.headline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(started(context.state), style: .timer).font(.body.monospacedDigit()).frame(maxWidth: 70)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(stepText(context)).font(.subheadline).lineLimit(2)
            Spacer(minLength: 8)
            StopLink(context: context)
          }
        }
      } compactLeading: {
        Image(systemName: context.state.awaiting ? "hand.raised.fill" : "sparkles")
          .foregroundColor(context.state.awaiting ? waitColor : brand)
      } compactTrailing: {
        Text(started(context.state), style: .timer).font(.caption2.monospacedDigit()).frame(maxWidth: 44)
      } minimal: {
        Image(systemName: context.state.awaiting ? "hand.raised.fill" : "sparkles").foregroundColor(brand)
      }
      .widgetURL(URL(string: "sklubot://bot/\(context.attributes.botId)"))
    }
  }
}
