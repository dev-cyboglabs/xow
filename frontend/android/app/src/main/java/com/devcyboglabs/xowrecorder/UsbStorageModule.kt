package com.devcyboglabs.xowrecorder

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class UsbStorageModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UsbStorage"

    // ─── Volume detection ────────────────────────────────────────────────────

    @ReactMethod
    fun getRemovableVolumes(promise: Promise) {
        try {
            val result = Arguments.createArray()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val sm = reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
                for (volume in sm.storageVolumes) {
                    if (!volume.isRemovable) continue
                    val state = volume.state
                    if (state == Environment.MEDIA_MOUNTED || state == Environment.MEDIA_MOUNTED_READ_ONLY) {
                        val map = Arguments.createMap()
                        map.putString("description", volume.getDescription(reactContext))
                        result.pushMap(map)
                    }
                }
            } else {
                val dirs = reactContext.getExternalFilesDirs(null)
                for (i in 1 until dirs.size) {
                    val dir = dirs[i] ?: continue
                    if (dir.exists() && dir.canRead()) {
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

    // ─── Permission helpers ──────────────────────────────────────────────────

    /**
     * Returns true if MANAGE_EXTERNAL_STORAGE is granted (Android 11+)
     * or if we're below Android 11 (legacy permissions cover it).
     */
    @ReactMethod
    fun hasManageStoragePermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            promise.resolve(Environment.isExternalStorageManager())
        } else {
            promise.resolve(true) // Not needed below API 30
        }
    }

    /**
     * Opens the "All files access" settings screen for this app so the user
     * can grant MANAGE_EXTERNAL_STORAGE.
     */
    @ReactMethod
    fun requestManageStoragePermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true) // Already allowed on older versions
            }
        } catch (e: Exception) {
            promise.reject("PERMISSION_ERROR", e.message ?: "Could not open settings", e)
        }
    }

    // ─── Storage path ────────────────────────────────────────────────────────

    /**
     * Returns the SD card ROOT path as file:///storage/XXXX-XXXX
     * when MANAGE_EXTERNAL_STORAGE is granted (Android 13 public access).
     *
     * Falls back to app-specific external dir if permission is not granted.
     * App-specific dir: /storage/XXXX-XXXX/Android/data/com.pkg/files
     */
    @ReactMethod
    fun getWritableExternalStoragePath(promise: Promise) {
        try {
            val hasFull = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Environment.isExternalStorageManager()
            } else true

            if (hasFull) {
                // Full access — return SD card root so we can write to /XoW/Videos publicly
                val sdRoot = findSdCardRoot()
                if (sdRoot != null) {
                    promise.resolve("file://$sdRoot")
                    return
                }
            }

            // No full access or no removable volume — return app-specific dir on SD card
            val dirs = reactContext.getExternalFilesDirs(null)
            for (i in 1 until dirs.size) {
                val dir = dirs[i] ?: continue
                if (!dir.exists()) dir.mkdirs()
                if (dir.exists() && dir.canWrite()) {
                    promise.resolve("file://${dir.absolutePath}")
                    return
                }
            }

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("USB_STORAGE_ERROR", e.message ?: "Unknown error", e)
        }
    }

    // ─── Internal storage path ───────────────────────────────────────────────

    /**
     * Returns the app-specific files dir on the PRIMARY (phone) internal storage
     * AND creates the XoW/Videos and XoW/Audio subdirectories using Java File API.
     *
     * Path: /storage/emulated/0/Android/data/com.devcyboglabs.xowrecorder/files
     * Visible: Files app → Internal Storage → Android → data → com.pkg → files → XoW
     */
    @ReactMethod
    fun getInternalStoragePath(promise: Promise) {
        try {
            // getExternalFilesDir(null) = primary emulated storage app-specific dir
            // This is /storage/emulated/0/Android/data/com.pkg/files — always writable
            val dir = reactContext.getExternalFilesDir(null)
                ?: reactContext.filesDir  // true fallback (internal private)

            if (!dir.exists()) dir.mkdirs()

            // Pre-create XoW/Videos and XoW/Audio so they appear in the file manager
            File(dir, "XoW/Videos").mkdirs()
            File(dir, "XoW/Audio").mkdirs()

            promise.resolve("file://${dir.absolutePath}")
        } catch (e: Exception) {
            promise.reject("STORAGE_ERROR", e.message ?: "Unknown error", e)
        }
    }

    /**
     * Creates a directory (and all parents) using Java File API.
     * Returns true if the directory exists after the call.
     */
    @ReactMethod
    fun mkdirs(path: String, promise: Promise) {
        try {
            val dir = File(path.removePrefix("file://"))
            dir.mkdirs()
            promise.resolve(dir.exists())
        } catch (e: Exception) {
            promise.reject("MKDIRS_ERROR", e.message ?: "Unknown error", e)
        }
    }

    // ─── File copy ───────────────────────────────────────────────────────────

    /**
     * Reliable Java-IO file copy. Works for both file:// and content:// sources.
     * Destination must be file://.
     */
    @ReactMethod
    fun copyFile(sourceUri: String, destPath: String, promise: Promise) {
        try {
            val destFile = File(destPath.removePrefix("file://"))
            destFile.parentFile?.mkdirs()

            val srcUri = Uri.parse(sourceUri)
            val inputStream = if (srcUri.scheme == "content") {
                reactContext.contentResolver.openInputStream(srcUri)
                    ?: throw Exception("Cannot open content URI: $sourceUri")
            } else {
                FileInputStream(File(sourceUri.removePrefix("file://")))
            }

            inputStream.use { input ->
                FileOutputStream(destFile).use { output ->
                    val buf = ByteArray(256 * 1024)
                    var len: Int
                    while (input.read(buf).also { len = it } != -1) {
                        output.write(buf, 0, len)
                    }
                    output.flush()
                }
            }

            if (destFile.exists() && destFile.length() > 0) {
                promise.resolve("file://${destFile.absolutePath}")
            } else {
                promise.reject("COPY_ERROR", "File was not written: ${destFile.absolutePath}")
            }
        } catch (e: Exception) {
            promise.reject("COPY_ERROR", e.message ?: "Unknown error", e)
        }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    /**
     * Finds the SD card root by stripping Android/data/... from the app-specific
     * external dir, then verifying it is NOT the emulated primary storage.
     */
    private fun findSdCardRoot(): String? {
        // API 30+: use StorageVolume.getDirectory()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val sm = reactContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
            for (volume in sm.storageVolumes) {
                if (!volume.isRemovable) continue
                if (volume.state != Environment.MEDIA_MOUNTED) continue
                val dir = volume.directory ?: continue
                return dir.absolutePath
            }
        }

        // API 24-29: derive root from getExternalFilesDirs
        val dirs = reactContext.getExternalFilesDirs(null)
        for (i in 1 until dirs.size) {
            val appDir = dirs[i] ?: continue
            val path = appDir.absolutePath
            val idx = path.indexOf("/Android/data/")
            if (idx < 0) continue
            val root = path.substring(0, idx)
            if (root.startsWith("/storage/") &&
                !root.contains("/emulated") &&
                root != "/storage/emulated/0"
            ) return root
        }
        return null
    }
}
