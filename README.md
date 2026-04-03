# Here are your Instructions
python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload

npx expo start

apk build steps 
1. cd android && ./gradlew clean
2. npx expo prebuild --clean --platform android
3. cd android && ./gradlew assembleRelease
  

1. adb reverse --list
2. adb reverse tcp:8000 tcp:8000
3. adb shell am force-stop com.devcyboglabs.xowrecorder && adb shell am start -n com.devcyboglabs.xowrecorder/.MainActivity


# Frontend Deploy
1. Frontend-dashboard folder has index.html, dashboard.js, dashboard.html upload three files in godaddy

# Build the Apk

cd /Users/KABILAN/Desktop/xow/frontend
cd android && ./gradlew clean && cd ..
npx expo prebuild --clean --platform android
cd android && ./gradlew assembleRelease

# APK Location
/Users/KABILAN/Desktop/xow/frontend/android/app/build/outputs/apk/release/app-release.apk