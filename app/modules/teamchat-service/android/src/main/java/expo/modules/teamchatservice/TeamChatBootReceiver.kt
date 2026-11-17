package expo.modules.teamchatservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** After a reboot, restarts the foreground service if the user was logged in (service enabled). */
class TeamChatBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") return
    if (!TeamChatForegroundService.isEnabled(context)) return
    try {
      TeamChatForegroundService.start(context)
    } catch (e: Exception) {
      Log.w("TeamChatService", "boot start failed", e)
    }
  }
}
