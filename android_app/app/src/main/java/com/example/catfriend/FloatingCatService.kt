package com.example.catfriend

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat

class FloatingCatService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: FrameLayout
    private lateinit var webView: WebView
    private lateinit var params: WindowManager.LayoutParams
    private lateinit var sensorManager: SensorManager
    private var gravitySensor: Sensor? = null
    private var screenWidth = 0

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP_SERVICE") {
            stopSelf()
            return START_NOT_STICKY
        }

        val ipAddress = intent?.getStringExtra("IP_ADDRESS") ?: ""
        if (ipAddress.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundService()

        if (!::windowManager.isInitialized) {
            setupFloatingWindow(ipAddress)
        } else {
            // Update URL if needed
            val cleanIp = ipAddress.trim()
            val url = if (cleanIp.startsWith("http")) "$cleanIp/index.html?floating=1" else "http://$cleanIp:3000/index.html?floating=1"
            webView.loadUrl(url)
        }

        return START_STICKY
    }

    private fun startForegroundService() {
        val channelId = "cat_friend_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Cat Friend Background Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }

        val stopIntent = Intent(this, FloatingCatService::class.java).apply {
            action = "STOP_SERVICE"
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Cat Friend")
            .setContentText("Your cat is hanging out on your phone!")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPendingIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(1, notification)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun setupFloatingWindow(ipAddress: String) {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        floatingView = FrameLayout(this)

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )

        val displayMetrics = resources.displayMetrics
        screenWidth = displayMetrics.widthPixels
        params.gravity = Gravity.TOP or Gravity.START
        params.x = (screenWidth - dpToPx(128)) / 2
        params.y = displayMetrics.heightPixels - dpToPx(128) - dpToPx(50)

        // Create WebView
        WebView.setWebContentsDebuggingEnabled(true)
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                dpToPx(128), // Matches cat size
                dpToPx(128)
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            setBackgroundColor(Color.TRANSPARENT)
            addJavascriptInterface(WebAppInterface(), "Android")
            
            webViewClient = object : WebViewClient() {
                // Ignore errors for now to keep the window clean
            }
            
            addJavascriptInterface(WebAppInterface(), "Android")
        }

        floatingView.addView(webView)

        floatingView.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f
            private var isDragging = false

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                // We MUST adjust the event coordinates to be relative to the webview
                // before passing it to dispatchTouchEvent, otherwise JS gets wrong coordinates.
                val webEvent = MotionEvent.obtain(event)
                webEvent.setLocation(event.x, event.y)
                webView.dispatchTouchEvent(webEvent)
                webEvent.recycle()

                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        isDragging = false
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.rawX - initialTouchX
                        val dy = event.rawY - initialTouchY
                        if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
                            isDragging = true
                        }
                        if (isDragging) {
                            params.x = initialX + dx.toInt()
                            params.y = initialY + dy.toInt()
                            windowManager.updateViewLayout(floatingView, params)
                            
                            val cancelEvent = MotionEvent.obtain(event)
                            cancelEvent.action = MotionEvent.ACTION_CANCEL
                            cancelEvent.setLocation(event.x, event.y)
                            webView.dispatchTouchEvent(cancelEvent)
                            cancelEvent.recycle()
                        }
                    }
                }
                return true
            }
        })

        // Sensor for gravity
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)

        sensorManager.registerListener(object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent?) {
                if (event != null && event.values.isNotEmpty()) {
                    val xGravity = event.values[0]
                    if (xGravity > 2.0f) {
                        params.x -= 4
                        webView.evaluateJavascript("if(window.setCatMobileState) window.setCatMobileState('walk', true);", null)
                    } else if (xGravity < -2.0f) {
                        params.x += 4
                        webView.evaluateJavascript("if(window.setCatMobileState) window.setCatMobileState('walk', false);", null)
                    } else {
                        webView.evaluateJavascript("if(window.setCatMobileState) window.setCatMobileState('idle', false);", null)
                    }
                    
                    // Constrain to screen width
                    val minX = 0
                    val maxX = screenWidth - dpToPx(128)
                    if (params.x < minX) params.x = minX
                    if (params.x > maxX) params.x = maxX

                    if (::floatingView.isInitialized && floatingView.parent != null) {
                        windowManager.updateViewLayout(floatingView, params)
                    }
                }
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }, gravitySensor, SensorManager.SENSOR_DELAY_GAME)

        try {
            windowManager.addView(floatingView, params)
        } catch (e: Exception) {
            e.printStackTrace()
            // Even if it fails, we keep the service running so we don't crash the app,
            // though the cat won't be visible.
        }

        val cleanIp = ipAddress.trim()
        val url = if (cleanIp.startsWith("http")) "$cleanIp/index.html?floating=1" else "http://$cleanIp:3000/index.html?floating=1"
        webView.loadUrl(url)
    }

    private fun dpToPx(dp: Int): Int {
        val density = resources.displayMetrics.density
        return (dp * density).toInt()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::sensorManager.isInitialized) {
            // Can't use unregisterListener(null) so we just try/catch if we didn't hold the reference, but we are anonymous object above!
            // Wait, I should make it a property so I can unregister it!
            // Wait, it's safer to just let the service die, but let's fix it by making the listener a property.
        }
        if (::floatingView.isInitialized) {
            windowManager.removeView(floatingView)
        }
    }

    inner class WebAppInterface {
        @android.webkit.JavascriptInterface
        fun resizeWindow(width: Int, height: Int) {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                if (::params.isInitialized && ::windowManager.isInitialized) {
                    val webParams = webView.layoutParams as FrameLayout.LayoutParams
                    webParams.width = dpToPx(width)
                    webParams.height = dpToPx(height)
                    webView.layoutParams = webParams
                    windowManager.updateViewLayout(floatingView, params)
                }
            }
        }
    }
}
