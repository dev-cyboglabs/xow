package com.devcyboglabs.xowrecorder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.hardware.usb.UsbManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class UsbStorageModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  private var receiverRegistered = false

  private val usbReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        UsbManager.ACTION_USB_DEVICE_ATTACHED -> sendUsbEvent("usbStorageChanged", true)
        UsbManager.ACTION_USB_DEVICE_DETACHED -> sendUsbEvent("usbStorageChanged", false)
      }
    }
  }

  override fun getName(): String = "UsbStorage"

  init {
    registerReceiver()
  }

  @ReactMethod
  fun isUsbDeviceAttached(promise: Promise) {
    try {
      val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as UsbManager
      promise.resolve(usbManager.deviceList.isNotEmpty())
    } catch (e: Exception) {
      promise.reject("USB_CHECK_FAILED", e)
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
      addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
      addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      reactContext.registerReceiver(usbReceiver, filter)
    }
    receiverRegistered = true
  }

  private fun unregisterReceiver() {
    if (!receiverRegistered) return
    try {
      reactContext.unregisterReceiver(usbReceiver)
    } catch (_: Exception) {
    }
    receiverRegistered = false
  }

  private fun sendUsbEvent(eventName: String, connected: Boolean) {
    val params = Arguments.createMap().apply {
      putBoolean("connected", connected)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }

  override fun invalidate() {
    unregisterReceiver()
    super.invalidate()
  }
}
