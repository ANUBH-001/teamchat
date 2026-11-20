package expo.modules.teamchatservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * Foreground service (type specialUse) that keeps the app process alive so the JS WebSocket
 * (src/realtime.ts) stays connected in the background or after the app is swiped from recents.
 * It also runs a never-ending headless JS task ("TeamChatService", see src/background.ts):
 * while a headless task is active React Native keeps JS timers running, so the reconnect
 * backoff keeps working. No wake lock is held (the CPU may sleep; network packets wake it).
 */
class TeamChatForegroundService : Service(), HeadlessJsTaskEventListener {

  companion object {
    private const val TAG = "TeamChatService"
    const val TASK_KEY = "TeamChatService"
    private const val CHANNEL_ID = "teamchat_service"
    private const val NOTIFICATION_ID = 7301
    private const val PREFS = "teamchat_service"
    private const val KEY_ENABLED = "enabled"

    @Volatile
    var running = false
      private set
    private var taskId: Int? = null // touched on the UI thread only

    fun setEnabled(context: Context, on: Boolean) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, on).apply()
    }

    fun isEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    fun start(context: Context) {
      val intent = Intent(context, TeamChatForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForeground must come first: a service started with startForegroundService() that skips it crashes the app.
    try {
      startInForeground()
    } catch (e: Exception) {
      Log.w(TAG, "startForeground failed", e)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!isEnabled(this)) { // logged out meanwhile, or a stale sticky restart
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    try {
      startJsTask()
    } catch (e: Exception) {
      Log.w(TAG, "headless task failed", e)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    val ctx = reactContext()
    if (ctx != null) {
      val headless = HeadlessJsTaskContext.getInstance(ctx)
      headless.removeTaskEventListener(this)
      val id = taskId
      if (id != null && headless.isTaskRunning(id)) {
        try {
          headless.finishTask(id)
        } catch (e: Exception) {
        }
      }
    }
    taskId = null
    super.onDestroy()
  }

  override fun onHeadlessJsTaskStart(taskId: Int) {}

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != Companion.taskId) return
    Companion.taskId = null
    if (!isEnabled(this)) stopSelf()
  }

  private fun startInForeground() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val builder: Notification.Builder
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Background connection", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Keeps KlapChat connected so message alerts arrive"
      channel.setSound(null, null)
      channel.enableVibration(false)
      channel.setShowBadge(false)
      nm.createNotificationChannel(channel)
      builder = Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      builder = Notification.Builder(this).setPriority(Notification.PRIORITY_LOW).setSound(null)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch != null) {
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
      builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, flags))
    }
    val notification = builder
      .setContentTitle("KlapChat connected")
      .setContentText("New message alerts are on")
      .setSmallIcon(android.R.drawable.stat_notify_chat)
      .setOngoing(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  // ---- headless JS task (same pattern as React Native's HeadlessJsTaskService, without its wake lock) ----

  private fun reactApp(): ReactApplication? = application as? ReactApplication

  @Suppress("DEPRECATION")
  private fun bridgeless(): Boolean = ReactFeatureFlags.enableBridgelessArchitecture

  private fun reactContext(): ReactContext? {
    val app = reactApp() ?: return null
    return if (bridgeless()) app.reactHost?.currentReactContext
    else app.reactNativeHost.reactInstanceManager.currentReactContext
  }

  private fun startJsTask() {
    val ctx = reactContext()
    val id = taskId
    if (ctx != null && id != null && HeadlessJsTaskContext.getInstance(ctx).isTaskRunning(id)) return
    if (ctx != null) {
      invokeTask(ctx)
      return
    }
    val app = reactApp() ?: return
    val listener = object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) {
        if (bridgeless()) app.reactHost?.removeReactInstanceEventListener(this)
        else app.reactNativeHost.reactInstanceManager.removeReactInstanceEventListener(this)
        UiThreadUtil.runOnUiThread { if (running && taskId == null) invokeTask(context) }
      }
    }
    if (bridgeless()) {
      val host = app.reactHost ?: return
      host.addReactInstanceEventListener(listener)
      host.start()
    } else {
      val manager = app.reactNativeHost.reactInstanceManager
      manager.addReactInstanceEventListener(listener)
      manager.createReactContextInBackground()
    }
  }

  private fun invokeTask(ctx: ReactContext) {
    val headless = HeadlessJsTaskContext.getInstance(ctx)
    headless.addTaskEventListener(this)
    // timeout 0 = no timeout; allowed while the app is in the foreground too
    taskId = headless.startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true))
  }
}
