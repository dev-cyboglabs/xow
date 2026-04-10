package com.devcyboglabs.xowrecorder

import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class UsbStorageModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UsbStorage"

    /**
     * Returns an array of removable storage volumes (USB OTG / SD card) that are mounted.
     * Each entry contains a "description" string.
     */
    @ReactMethod
    fun getRemovableVolumes(promise: Promise) {
        try {
            val result = Arguments.createArray()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // API 24+: use StorageManager.getStorageVolumes()
                val storageManager =
                    reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
                for (volume in storageManager.storageVolumes) {
                    if (volume.isRemovable) {
                        val state = volume.state
                        if (state == Environment.MEDIA_MOUNTED ||
                            state == Environment.MEDIA_MOUNTED_READ_ONLY
                        ) {
                            val map = Arguments.createMap()
                            map.putString("description", volume.getDescription(reactContext))
                            result.pushMap(map)
                        }
                    }
                }
            } else {
                // API < 24 fallback: secondary dirs in getExternalFilesDirs are removable
                val dirs = reactContext.getExternalFilesDirs(null)
                for (i in 1 until dirs.size) {
                    val dir = dirs[i]
                    if (dir != null && dir.exists() && dir.canRead()) {
                        val map = Arguments.createMap()
                        map.putString("description", "External Storage $i")
                        result.pushMap(map)
                    }
                }
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("USB_STORAGE_ERROR", e.message ?: "Unknown error", e)
        }
    }

    /**
     * Returns a writable file:// path on the first available removable storage, or null.
     * Uses app-specific external dirs (no extra permissions required on API 29+).
     */
    @ReactMethod
    fun getWritableExternalStoragePath(promise: Promise) {
        try {
            // getExternalFilesDirs: index 0 = primary (emulated), index 1+ = removable (SD/USB)
            val dirs = reactContext.getExternalFilesDirs(null)
            for (i in 1 until dirs.size) {
                val dir = dirs[i] ?: continue
                if (!dir.exists()) dir.mkdirs()
                if (dir.exists() && dir.canWrite()) {
                    promise.resolve("file://${dir.absolutePath}")
                    return
                }
            }

            // API 30+ additional check via StorageVolume.getDirectory()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val storageManager =
                    reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
                for (volume in storageManager.storageVolumes) {
                    if (volume.isRemovable && volume.state == Environment.MEDIA_MOUNTED) {
                        val dir = volume.directory
                        if (dir != null && dir.canWrite()) {
                            promise.resolve("file://${dir.absolutePath}")
                            return
                        }
                    }
                }
            }

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("USB_STORAGE_ERROR", e.message ?: "Unknown error", e)
        }
    }
}
