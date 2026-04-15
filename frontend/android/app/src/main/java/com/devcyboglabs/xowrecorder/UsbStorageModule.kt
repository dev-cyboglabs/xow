package com.devcyboglabs.xowrecorder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class UsbStorageModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private var listening = false

  private val storageReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      emitStorageChanged(hasRemovableVolume())
    }
  }

  override fun getName(): String = "UsbStorage"

  @ReactMethod
  fun addListener(eventName: String) {
  }

  @ReactMethod
  fun removeListeners(count: Int) {
  }

  @ReactMethod
  fun startListening() {
    if (listening) {
      emitStorageChanged(hasRemovableVolume())
      return
    }

    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_MEDIA_MOUNTED)
      addAction(Intent.ACTION_MEDIA_UNMOUNTED)
      addAction(Intent.ACTION_MEDIA_REMOVED)
      addAction(Intent.ACTION_MEDIA_BAD_REMOVAL)
      addAction(Intent.ACTION_MEDIA_EJECT)
      addDataScheme("file")
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(storageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      reactContext.registerReceiver(storageReceiver, filter)
    }
    listening = true
    emitStorageChanged(hasRemovableVolume())
  }

  @ReactMethod
  fun stopListening() {
    if (!listening) return
    try {
      reactContext.unregisterReceiver(storageReceiver)
    } catch (_: Exception) {
    }
    listening = false
  }

  @ReactMethod
  fun isUsbDeviceAttached(promise: Promise) {
    promise.resolve(hasRemovableVolume())
  }

  @ReactMethod
  fun getRemovableVolumes(promise: Promise) {
    try {
      val result = Arguments.createArray()
      val seenKeys = mutableSetOf<String>()

      getStorageManager()?.storageVolumes?.forEach { volume ->
        if (!volume.isRemovable) return@forEach
        val description = try {
          volume.getDescription(reactContext)
        } catch (_: Exception) {
          "External Storage"
        }
        val state = getVolumeState(volume)
        val path = getVolumeDirectory(volume)?.absolutePath ?: ""
        val key = if (path.isNotBlank()) path else "$description:$state"
        if (seenKeys.add(key)) {
          val item = Arguments.createMap()
          item.putString("description", description)
          item.putString("state", state)
          item.putBoolean("isRemovable", true)
          if (path.isNotBlank()) {
            item.putString("path", path)
          }
          result.pushMap(item)
        }
      }

      reactContext.getExternalFilesDirs(null)
        .filterNotNull()
        .forEach { file ->
          val removable = try {
            Environment.isExternalStorageRemovable(file)
          } catch (_: Exception) {
            false
          }
          if (!removable) return@forEach
          val state = getExternalState(file)
          val key = file.absolutePath
          if (seenKeys.add(key)) {
            val item = Arguments.createMap()
            item.putString("description", file.name.ifBlank { "External Storage" })
            item.putString("state", state)
            item.putBoolean("isRemovable", true)
            item.putString("path", file.absolutePath)
            result.pushMap(item)
          }
        }

      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("USB_STORAGE_VOLUMES_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun getWritableExternalStoragePath(promise: Promise) {
    try {
      val removableDir = findWritableRemovableDir()
      if (removableDir != null) {
        promise.resolve(removableDir.absolutePath)
        return
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
        val volumeDir = getStorageManager()?.storageVolumes
          ?.asSequence()
          ?.filter { it.isRemovable }
          ?.mapNotNull { getVolumeDirectory(it) }
          ?.firstOrNull { it.exists() && (it.canWrite() || it.mkdirs()) }
        if (volumeDir != null) {
          promise.resolve(volumeDir.absolutePath)
          return
        }
      }

      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("USB_STORAGE_PATH_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun getInternalStoragePath(promise: Promise) {
    try {
      val internalDir = reactContext.getExternalFilesDirs(null)
        .filterNotNull()
        .firstOrNull {
          try {
            !Environment.isExternalStorageRemovable(it)
          } catch (_: Exception) {
            false
          }
        }
        ?: reactContext.getExternalFilesDir(null)
        ?: reactContext.filesDir
      promise.resolve(internalDir.absolutePath)
    } catch (error: Exception) {
      promise.reject("USB_STORAGE_INTERNAL_PATH_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun hasManageStoragePermission(promise: Promise) {
    val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      true
    }
    promise.resolve(granted)
  }

  @ReactMethod
  fun requestManageStoragePermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      promise.resolve(true)
      return
    }

    try {
      val activity = reactContext.currentActivity
      if (activity == null) {
        promise.reject("USB_STORAGE_ACTIVITY_MISSING", "Current activity is unavailable")
        return
      }

      val intent = Intent(
        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
        Uri.parse("package:${reactContext.packageName}")
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      promise.resolve(true)
    } catch (_: Exception) {
      try {
        val fallbackIntent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
        fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(fallbackIntent)
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("USB_STORAGE_PERMISSION_ERROR", error.message, error)
      }
    }
  }

  @ReactMethod
  fun mkdirs(path: String, promise: Promise) {
    try {
      val dir = File(normalizePath(path))
      if (dir.exists() || dir.mkdirs()) {
        promise.resolve(null)
      } else {
        promise.reject("USB_STORAGE_MKDIRS_ERROR", "Failed to create directory: $path")
      }
    } catch (error: Exception) {
      promise.reject("USB_STORAGE_MKDIRS_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun copyFile(sourceUri: String, destPath: String, promise: Promise) {
    try {
      val destination = File(normalizePath(destPath))
      destination.parentFile?.let {
        if (!it.exists()) {
          it.mkdirs()
        }
      }

      openSourceStream(sourceUri).use { input ->
        FileOutputStream(destination).use { output ->
          val buffer = ByteArray(65536)
          while (true) {
            val count = input.read(buffer)
            if (count == -1) break
            output.write(buffer, 0, count)
          }
          output.flush()
          output.fd.sync()
        }
      }

      promise.resolve(destination.absolutePath)
    } catch (error: Exception) {
      promise.reject("USB_STORAGE_COPY_ERROR", error.message, error)
    }
  }

  private fun emitStorageChanged(connected: Boolean) {
    if (!reactContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putBoolean("connected", connected)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("usbStorageChanged", payload)
  }

  private fun hasRemovableVolume(): Boolean {
    if (findWritableRemovableDir() != null) {
      return true
    }
    return try {
      getStorageManager()?.storageVolumes?.any { it.isRemovable } == true
    } catch (_: Exception) {
      false
    }
  }

  private fun getStorageManager(): StorageManager? {
    return reactContext.getSystemService(Context.STORAGE_SERVICE) as? StorageManager
  }

  private fun findWritableRemovableDir(): File? {
    return reactContext.getExternalFilesDirs(null)
      .filterNotNull()
      .firstOrNull { file ->
        try {
          Environment.isExternalStorageRemovable(file) &&
            getExternalState(file) == Environment.MEDIA_MOUNTED &&
            (file.exists() || file.mkdirs())
        } catch (_: Exception) {
          false
        }
      }
  }

  private fun getExternalState(file: File): String {
    return try {
      Environment.getExternalStorageState(file)
    } catch (_: Exception) {
      Environment.MEDIA_UNKNOWN
    }
  }

  private fun getVolumeState(volume: StorageVolume): String {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        volume.state ?: Environment.MEDIA_UNKNOWN
      } else {
        getVolumeDirectory(volume)?.let { getExternalState(it) } ?: Environment.MEDIA_UNKNOWN
      }
    } catch (_: Exception) {
      Environment.MEDIA_UNKNOWN
    }
  }

  private fun getVolumeDirectory(volume: StorageVolume): File? {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        volume.directory
      } else {
        val method = StorageVolume::class.java.getDeclaredMethod("getPathFile")
        method.isAccessible = true
        method.invoke(volume) as? File
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun normalizePath(path: String): String {
    return if (path.startsWith("file://")) {
      Uri.parse(path).path ?: path.removePrefix("file://")
    } else {
      path
    }
  }

  private fun openSourceStream(sourceUri: String): FileInputStream {
    if (sourceUri.startsWith("content://")) {
      throw IllegalArgumentException("content:// sources are not supported by native copyFile")
    }
    val sourcePath = normalizePath(sourceUri)
    return FileInputStream(File(sourcePath))
  }
}
