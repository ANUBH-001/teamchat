package expo.modules.teamchatservice

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TeamChatServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TeamChatService")

    // Enable + start (no-op when already running). Called after login and on every app open.
    Function("start") {
      val ctx = context
      TeamChatForegroundService.setEnabled(ctx, true)
      if (!TeamChatForegroundService.running) TeamChatForegroundService.start(ctx)
    }

    // Disable + stop (logout).
    Function("stop") {
      val ctx = context
      TeamChatForegroundService.setEnabled(ctx, false)
      ctx.stopService(Intent(ctx, TeamChatForegroundService::class.java))
    }

    Function("isRunning") { TeamChatForegroundService.running }

    Function("isIgnoringBatteryOptimizations") { ignoringBattery() }

    // Opens the "allow unrestricted battery" dialog if not yet allowed, else App info (Battery -> Unrestricted).
    Function("openBatterySettings") { openBatterySettings() }
  }

  private fun ignoringBattery(): Boolean {
    val ctx = context
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    return (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)
  }

  private fun openBatterySettings(): Boolean {
    val ctx = context
    val pkg = Uri.parse("package:" + ctx.packageName)
    val intents = mutableListOf<Intent>()
    if (!ignoringBattery()) intents.add(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
    intents.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
    intents.add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    val activity = appContext.currentActivity
    for (intent in intents) {
      try {
        if (activity != null) activity.startActivity(intent)
        else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (e: Exception) {
        // try the next one
      }
    }
    return false
  }
}
