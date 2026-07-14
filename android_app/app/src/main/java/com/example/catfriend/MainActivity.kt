package com.example.catfriend

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.example.catfriend.theme.CatFriendTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CatFriendTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppScreen()
                }
            }
        }
    }
}

@Composable
fun AppScreen() {
    val context = LocalContext.current
    var ipAddress by remember { mutableStateOf("") }
    var serviceStarted by remember { mutableStateOf(false) }
    var permissionRequested by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (!serviceStarted) {
            Text(
                text = "Connect to Desktop",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(bottom = 32.dp)
            )
            
            OutlinedTextField(
                value = ipAddress,
                onValueChange = { ipAddress = it },
                label = { Text("Desktop IP Address") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            )
            
            Button(
                onClick = {
                    if (ipAddress.isNotBlank()) {
                        if (!Settings.canDrawOverlays(context) && !permissionRequested) {
                            permissionRequested = true
                            val intent = Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:${context.packageName}")
                            )
                            context.startActivity(intent)
                        } else {
                            val serviceIntent = Intent(context, FloatingCatService::class.java).apply {
                                putExtra("IP_ADDRESS", ipAddress)
                            }
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent)
                            } else {
                                context.startService(serviceIntent)
                            }
                            serviceStarted = true
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Start Floating Cat")
            }
            
            if (permissionRequested) {
                Button(
                    onClick = {
                        if (ipAddress.isNotBlank()) {
                            val serviceIntent = Intent(context, FloatingCatService::class.java).apply {
                                putExtra("IP_ADDRESS", ipAddress)
                            }
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent)
                            } else {
                                context.startService(serviceIntent)
                            }
                            serviceStarted = true
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Force Start (If Permission Denied Bug)")
                }
            }
        } else {
            Text(
                text = "Cat is now floating!",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(bottom = 32.dp)
            )
            Button(
                onClick = {
                    val stopIntent = Intent(context, FloatingCatService::class.java).apply {
                        action = "STOP_SERVICE"
                    }
                    context.startService(stopIntent)
                    serviceStarted = false
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Stop Floating Cat")
            }
        }
    }
}

