package com.devcyboglabs.xowrecorder

import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.Settings
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class UsbStorageModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "UsbStorage"
    }

    /**
     * Returns a list of removable storage volumes (USB OTG, SD cards).
     * Each volume has a description field (e.g., "USB Drive", "SD Card").
     */
    @ReactMethod
    fun getRemovableVolumes(promise: Promise) {
        try {
            val storageManager = reactApplicationContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
            val volumes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                storageManager.storageVolumes
            } else {
                emptyList()
            }

            val removableVolumes = WritableNativeArray()
            for (volume in volumes) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    if (volume.isRemovable) {
                        val volumeInfo = WritableNativeMap()
                        volumeInfo.putString("description", volume.getDescription(reactApplicationContext) ?: "Removable Storage")
                        removableVolumes.pushMap(volumeInfo)
                    }
                }
            }

            promise.resolve(removableVolumes)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to get removable volumes: ${e.message}", e)
        }
    }

    /**
     * Returns a writable path on external storage (SD card / USB OTG).
     * On Android 11+, this requires MANAGE_EXTERNAL_STORAGE permission.
     * Returns the public root of the removable storage (e.g., /storage/XXXX-XXXX/).
     */
    @ReactMethod
    fun getWritableExternalStoragePath(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val storageManager = reactApplicationContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
                val volumes = storageManager.storageVolumes

                for (volume in volumes) {
                    if (volume.isRemovable && volume.state == Environment.MEDIA_MOUNTED) {
                        // Try to get the public root path
                        val volumePath = getVolumeRootPath(volume)
                        if (volumePath != null && File(volumePath).canWrite()) {
                            promise.resolve(volumePath)
                            return
                        }

                        // Fallback: app-specific external directory
                        val externalDirs = reactApplicationContext.getExternalFilesDirs(null)
                        for (dir in externalDirs) {
                            if (dir != null && Environment.isExternalStorageRemovable(dir)) {
                                promise.resolve(dir.absolutePath)
                                return
                            }
                        }
                    }
                }
            }

            // No removable storage found
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to get writable external storage: ${e.message}", e)
        }
    }

    /**
     * Returns the internal storage path (phone's built-in storage).
     * This is the app-specific directory on internal storage.
     */
    @ReactMethod
    fun getInternalStoragePath(promise: Promise) {
        try {
            val internalDir = reactApplicationContext.getExternalFilesDir(null)
            if (internalDir != null) {
                promise.resolve(internalDir.absolutePath)
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to get internal storage path: ${e.message}", e)
        }
    }

    /**
     * Checks if the app has MANAGE_EXTERNAL_STORAGE permission (Android 11+).
     */
    @ReactMethod
    fun hasManageStoragePermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val hasPermission = Environment.isExternalStorageManager()
                promise.resolve(hasPermission)
            } else {
                // Not needed on Android 10 and below
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to check MANAGE_EXTERNAL_STORAGE permission: ${e.message}", e)
        }
    }

    /**
     * Requests MANAGE_EXTERNAL_STORAGE permission (Android 11+).
     * Opens the system settings page for the app.
     */
    @ReactMethod
    fun requestManageStoragePermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                intent.data = Uri.parse("package:${reactApplicationContext.packageName}")
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to request MANAGE_EXTERNAL_STORAGE permission: ${e.message}", e)
        }
    }

    /**
     * Creates a directory (and parent directories) at the given path.
     * Uses native Java File.mkdirs() to ensure compatibility across all Android storage types.
     */
    @ReactMethod
    fun mkdirs(path: String, promise: Promise) {
        try {
            val dir = File(path)
            val success = dir.mkdirs() || dir.exists()
            if (success) {
                promise.resolve(path)
            } else {
                promise.reject("ERROR", "Failed to create directory: $path")
            }
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to create directory: ${e.message}", e)
        }
    }

    /**
     * Copies a file from sourceUri to destPath using native Java IO.
     * This is more reliable than React Native's FileSystem.copyAsync for cross-storage copies.
     */
    @ReactMethod
    fun copyFile(sourceUri: String, destPath: String, promise: Promise) {
        try {
            val sourceFile = if (sourceUri.startsWith("content://")) {
                // Handle content:// URIs
                val inputStream = reactApplicationContext.contentResolver.openInputStream(Uri.parse(sourceUri))
                    ?: throw Exception("Failed to open content URI: $sourceUri")
                
                val destFile = File(destPath)
                destFile.parentFile?.mkdirs()
                
                val outputStream = FileOutputStream(destFile)
                inputStream.use { input ->
                    outputStream.use { output ->
                        input.copyTo(output)
                    }
                }
                destFile
            } else {
                // Handle file:// URIs
                val cleanSourcePath = sourceUri.removePrefix("file://")
                val sourceFile = File(cleanSourcePath)
                val destFile = File(destPath)
                
                destFile.parentFile?.mkdirs()
                
                FileInputStream(sourceFile).use { input ->
                    FileOutputStream(destFile).use { output ->
                        input.copyTo(output)
                    }
                }
                destFile
            }

            promise.resolve(sourceFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to copy file: ${e.message}", e)
        }
    }

    /**
     * Helper function to get the root path of a storage volume.
     * Uses reflection to access hidden StorageVolume.getPath() method.
     */
    private fun getVolumeRootPath(volume: StorageVolume): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Android 11+ has a public API
                volume.directory?.absolutePath
            } else {
                // Use reflection for older versions
                val getPathMethod = volume.javaClass.getMethod("getPath")
                getPathMethod.invoke(volume) as? String
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Sends an event to JavaScript when USB storage is connected/disconnected.
     */
    fun sendUsbStorageChangedEvent(isConnected: Boolean) {
        val params = WritableNativeMap()
        params.putBoolean("isConnected", isConnected)
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("usbStorageChanged", params)
    }
}
