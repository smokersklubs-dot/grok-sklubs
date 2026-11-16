package app.sklubot.android.relay

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.sklubot.android.R

/**
 * Quick-settings tile "Stop Sklubot" (https://developer.android.com/develop/ui/views/quicksettings-tiles):
 * one tap ends any bot's control and locks the relay, as Stop in the notification. Active while the relay is on.
 */
class StopTileService : TileService() {
    override fun onStartListening() {
        val tile = qsTile ?: return
        val on = RelayHub.prefs(this).enabled
        val controlled = RelayHub.core?.session != null
        tile.state = if (on && !RelayHub.prefs(this).isLocked()) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(if (controlled) R.string.tile_stop_control else R.string.tile_label)
        tile.updateTile()
    }

    override fun onClick() {
        RelayHub.stop(this, "tile")
        onStartListening()
    }
}
