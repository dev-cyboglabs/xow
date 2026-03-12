package com.devcyboglabs.xowrecorder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

class UsbStorageModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  private var receiverRegistered = false

  // Listen for storage mount/unmount events (correct for USB mass storage)
  private val storageReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        Intent.ACTION_MEDIA_MOUNTED -> sendStorageEvent(true)
        Intent.ACTION_MEDIA_UNMOUNTED,
        Intent.ACTION_MEDIA_REMOVED,
        Intent.ACTION_MEDIA_EJECT -> sendStorageEvent(false)
      }
    }
  }

  override fun getName(): String = "UsbStorage"

  init {
    registerReceiver()
  }

  // Returns true if any removable storage volume is currently mounted
  @ReactMethod
  fun isUsbDeviceAttached(promise: Promise) {
    try {
      val sm = reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      val hasRemovable = sm.storageVolumes.any {
        it.isRemovable && it.state == Environment.MEDIA_MOUNTED
      }
      promise.resolve(hasRemovable)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  // Returns array of removable mounted volume descriptions
  @ReactMethod
  fun getRemovableVolumes(promise: Promise) {
    try {
      val sm = reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      val result = Arguments.createArray()
      for (vol in sm.storageVolumes) {
        if (!vol.isRemovable || vol.state != Environment.MEDIA_MOUNTED) continue
        val info = Arguments.createMap()
        info.putString("description", vol.getDescription(reactContext))
        info.putString("state", vol.state)
        info.putBoolean("isRemovable", vol.isRemovable)
        result.pushMap(info)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("STORAGE_VOLUMES_FAILED", e.message)
    }
  }

  // Returns a writable app-specific path on the removable storage
  @ReactMethod
  fun getWritableExternalStoragePath(promise: Promise) {
    try {
      // First confirm a removable volume is mounted via StorageManager
      val sm = reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      val hasRemovable = sm.storageVolumes.any {
        it.isRemovable && it.state == Environment.MEDIA_MOUNTED
      }
      if (!hasRemovable) {
        promise.resolve(null)
        return
      }

      // Find the corresponding app-specific directory on that removable volume
      val dirs = reactContext.getExternalFilesDirs(null)
      for (dir in dirs) {
        if (dir == null || !dir.exists()) continue
        if (Environment.getExternalStorageState(dir) != Environment.MEDIA_MOUNTED) continue
        if (!Environment.isExternalStorageRemovable(dir)) continue
        if (Environment.isExternalStorageEmulated(dir)) continue

        val targetDir = File(dir, "XoW")
        if (!targetDir.exists() && !targetDir.mkdirs()) continue

        val testFile = File(targetDir, ".wtest")
        return try {
          testFile.writeText("1")
          testFile.delete()
          promise.resolve("file://${targetDir.absolutePath}")
        } catch (_: Exception) {
          continue
        }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  // List files in a directory (for file:// paths on external storage)
  @ReactMethod
  fun listFiles(dirPath: String, promise: Promise) {
    try {
      val cleanPath = dirPath.removePrefix("file://")
      val dir = File(cleanPath)
      if (!dir.exists() || !dir.isDirectory) {
        promise.reject("NOT_FOUND", "Directory not found: $dirPath")
        return
      }
      val result = Arguments.createArray()
      dir.listFiles()?.sortedBy { it.name }?.forEach { file ->
        val info = Arguments.createMap()
        info.putString("name", file.name)
        info.putString("path", "file://${file.absolutePath}")
        info.putBoolean("isDirectory", file.isDirectory)
        info.putDouble("size", file.length().toDouble())
        info.putDouble("lastModified", file.lastModified().toDouble())
        result.pushMap(info)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("LIST_FILES_FAILED", e.message)
    }
  }

  @ReactMethod
  fun startListening() {
    registerReceiver()
  }

  @ReactMethod
  fun stopListening() {
    unregisterReceiver()
  }

  private fun registerReceiver() {
    if (receiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_MEDIA_MOUNTED)
      addAction(Intent.ACTION_MEDIA_UNMOUNTED)
      addAction(Intent.ACTION_MEDIA_REMOVED)
      addAction(Intent.ACTION_MEDIA_EJECT)
      addDataScheme("file")
    }
    // System media broadcasts require RECEIVER_EXPORTED on API 33+
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(storageReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      reactContext.registerReceiver(storageReceiver, filter)
    }
    receiverRegistered = true
  }

  private fun unregisterReceiver() {
    if (!receiverRegistered) return
    try { reactContext.unregisterReceiver(storageReceiver) } catch (_: Exception) {}
    receiverRegistered = false
  }

  private fun sendStorageEvent(mounted: Boolean) {
    val params = Arguments.createMap().apply { putBoolean("connected", mounted) }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("usbStorageChanged", params)
  }

  override fun invalidate() {
    unregisterReceiver()
    super.invalidate()
  }
}
